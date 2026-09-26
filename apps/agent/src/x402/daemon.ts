import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterceptaClient, createProfiler, type Address } from "@eaw/risk";
import { loadAgentConfig } from "./config";
import { payUrl } from "./pay";
import { createStore } from "./store";

const config = loadAgentConfig();
const client = createInterceptaClient({ apiKey: config.interceptaKey });
const ctx = { config, client, profiler: createProfiler(client), store: createStore() };

const MAX_BODY_BYTES = 64 * 1024;

class BodyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": config.uiOrigin,
    "access-control-allow-headers": "content-type",
    vary: "origin"
  });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
};

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  let bytes = 0;
  for await (const chunk of req) {
    bytes += (chunk as Buffer).length;
    if (bytes > MAX_BODY_BYTES) throw new BodyError(413, "body too large");
    raw += chunk;
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new BodyError(400, "invalid json");
  }
}

/** Every mutating route must be a same-origin JSON request from the configured UI. */
function checkMutationGuards(req: IncomingMessage, res: ServerResponse): boolean {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    json(res, 415, { error: "content-type must be application/json" });
    return false;
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== config.uiOrigin) {
    json(res, 403, { error: "origin not allowed" });
    return false;
  }
  return true;
}

function sameOrigin(target: string, base: string): boolean {
  try {
    return new URL(target).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") return json(res, 204, {});
    if (req.method === "GET" && url.pathname === "/decisions") return json(res, 200, ctx.store.listDecisions());
    if (req.method === "GET" && url.pathname === "/holds") return json(res, 200, ctx.store.listHolds());
    if (req.method === "GET" && url.pathname.startsWith("/profiles/")) {
      return json(res, 200, await ctx.profiler.getProfile(url.pathname.split("/")[2] as Address));
    }
    if (req.method === "POST" && url.pathname === "/pay") {
      if (!checkMutationGuards(req, res)) return;
      const body = await readBody(req);
      const target = String(body.url ?? `${config.serviceUrl}/dataset`);
      if (!sameOrigin(target, config.serviceUrl)) return json(res, 400, { error: "url must be on the configured service" });
      return json(res, 200, await payUrl(ctx, target, body.wallet === "risky" ? "risky" : "default"));
    }
    const hold = url.pathname.match(/^\/holds\/([^/]+)\/(approve|reject)$/);
    if (req.method === "POST" && hold) {
      if (!checkMutationGuards(req, res)) return;
      const resolved = ctx.store.resolveHold(hold[1], hold[2] === "approve" ? "approved" : "rejected");
      if (resolved.status === "rejected") {
        const original = ctx.store.updateDecision(resolved.decisionId, {
          status: "refused",
          verdict: { kind: "REFUSE", reasons: [...resolved.reasons, { source: "owner", code: "owner_rejected", detail: "Rejected by wallet owner" }] }
        });
        return json(res, 200, original);
      }
      const decision = await payUrl(ctx, resolved.url, resolved.walletKey, { payTo: resolved.payTo, amount: BigInt(resolved.amount) });
      const updated = ctx.store.updateDecision(decision.id, { holdId: resolved.id });
      ctx.store.updateDecision(resolved.decisionId, { status: "superseded", resolvedBy: updated.id });
      return json(res, 200, updated);
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    if (error instanceof BodyError) return json(res, error.status, { error: error.message });
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}).listen(config.port, "127.0.0.1", () => console.log(`agent daemon on http://127.0.0.1:${config.port}`));
