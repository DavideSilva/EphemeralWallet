import type { IncomingMessage, ServerResponse } from "node:http";
import { isAddress } from "viem";
import type { PayContext, payUrl } from "./pay";
import type { WalletRef } from "./config";

const MAX_BODY_BYTES = 64 * 1024;

export type DaemonDeps = PayContext & {
  pay: typeof payUrl;
  walletStatus: (ref: WalletRef) => Promise<object>;
};

class BodyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  let bytes = 0;
  for await (const chunk of req) {
    bytes += (chunk as Buffer).length;
    if (bytes > MAX_BODY_BYTES) throw new BodyError(413, "body too large");
    raw += chunk;
  }
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BodyError(400, "invalid json");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new BodyError(400, "invalid json");
  return parsed as Record<string, unknown>;
}

function sameOrigin(target: string, base: string): boolean {
  try {
    return new URL(target).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/** Request handler for the localhost agent daemon; `daemon.ts` binds it to 127.0.0.1. */
export function createDaemonHandler(deps: DaemonDeps) {
  const { config, store } = deps;
  // A Host other than our own loopback name means DNS rebinding: refuse it on every route.
  const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);

  const headers = {
    "access-control-allow-origin": config.uiOrigin,
    "access-control-allow-headers": "content-type",
    vary: "origin"
  };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { ...headers, "content-type": "application/json" });
    res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  };

  /** Every mutating route must be a JSON request carrying the configured UI's Origin (browsers always send it on POST). */
  function checkMutationGuards(req: IncomingMessage, res: ServerResponse): boolean {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      json(res, 415, { error: "content-type must be application/json" });
      return false;
    }
    if (req.headers.origin !== config.uiOrigin) {
      json(res, 403, { error: "origin not allowed" });
      return false;
    }
    return true;
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!allowedHosts.has(req.headers.host ?? "")) return json(res, 421, { error: "host not allowed" });
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "OPTIONS") {
        res.writeHead(204, headers);
        return res.end();
      }
      if (req.method === "GET" && url.pathname === "/decisions") return json(res, 200, store.listDecisions());
      if (req.method === "GET" && url.pathname === "/holds") return json(res, 200, store.listHolds());
      if (req.method === "GET" && url.pathname === "/wallets") {
        const entries = Object.entries(config.wallets).filter(([, ref]) => ref !== undefined);
        const statuses = await Promise.all(entries.map(async ([key, ref]) => ({ key, ...(await deps.walletStatus(ref!)) })));
        return json(res, 200, statuses);
      }
      if (req.method === "GET" && url.pathname.startsWith("/profiles/")) {
        const address = url.pathname.split("/")[2];
        if (!isAddress(address, { strict: false })) return json(res, 400, { error: "invalid address" });
        return json(res, 200, await deps.profiler.getProfile(address));
      }
      if (req.method === "POST" && url.pathname === "/pay") {
        if (!checkMutationGuards(req, res)) return;
        const body = await readBody(req);
        const target = String(body.url ?? `${config.serviceUrl}/dataset`);
        if (!sameOrigin(target, config.serviceUrl)) return json(res, 400, { error: "url must be on the configured service" });
        return json(res, 200, await deps.pay(deps, target, body.wallet === "risky" ? "risky" : "default"));
      }
      const hold = url.pathname.match(/^\/holds\/([^/]+)\/(approve|reject)$/);
      if (req.method === "POST" && hold) {
        if (!checkMutationGuards(req, res)) return;
        const resolved = store.resolveHold(hold[1], hold[2] === "approve" ? "approved" : "rejected");
        if (resolved.status === "rejected") {
          const original = store.updateDecision(resolved.decisionId, {
            status: "refused",
            verdict: { kind: "REFUSE", reasons: [...resolved.reasons, { source: "owner", code: "owner_rejected", detail: "Rejected by wallet owner" }] }
          });
          return json(res, 200, original);
        }
        let decision;
        try {
          decision = await deps.pay(deps, resolved.url, resolved.walletKey, { payTo: resolved.payTo, amount: BigInt(resolved.amount) });
        } catch (error) {
          // Never strand an approved hold: put it back in the inbox and leave the original decision "held".
          store.reopenHold(resolved.id);
          return json(res, 502, { error: error instanceof Error ? error.message : String(error) });
        }
        const updated = store.updateDecision(decision.id, { holdId: resolved.id });
        // "failed" means nothing was approved on-chain (that would be "unsettled"), so the owner can simply retry.
        if (decision.status === "failed") {
          store.reopenHold(resolved.id);
          return json(res, 502, { error: decision.error ?? "payment failed" });
        }
        store.updateDecision(resolved.decisionId, { status: "superseded", resolvedBy: updated.id });
        return json(res, 200, updated);
      }
      json(res, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof BodyError) return json(res, error.status, { error: error.message });
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
