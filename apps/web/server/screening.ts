import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { isAddress } from "viem";
import { createInterceptaClient, createProfiler, type Profiler } from "../../../packages/risk/src/index";

export type ScreeningStatus = "trusted" | "caution" | "blocked" | "unverified";

export type ScreeningResponse = {
  address: string;
  status: ScreeningStatus;
  toxicScore?: number;
  reasons: { code: string; detail: string }[];
  labels: string[];
  screenedAt: string;
  detail?: string;
};

const statusFor = { TRUSTED: "trusted", CAUTION: "caution", BLOCKED: "blocked" } as const;

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Screens a merchant for the issue-card flow; any failure is reported as unverified, never as trusted. */
export async function screenMerchant(profiler: Profiler | undefined, address: `0x${string}`): Promise<ScreeningResponse> {
  const unverified = (detail: string): ScreeningResponse => ({
    address,
    status: "unverified",
    reasons: [],
    labels: [],
    screenedAt: new Date().toISOString(),
    detail,
  });
  if (!profiler) return unverified("No INTERCEPTA_API_KEY is set, so this merchant couldn't be checked.");

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const profile = await profiler.getProfile(address, "payee");
      return {
        address,
        status: statusFor[profile.tier],
        toxicScore: profile.toxicScore,
        reasons: profile.reasons.map(r => ({ code: r.code, detail: r.detail })),
        labels: profile.labels,
        screenedAt: profile.screenedAt,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (/HTTP 404/.test(lastError)) return unverified("Intercepta has no record of this address.");
    }
  }
  return unverified(`Intercepta didn't give a usable answer (${lastError}).`);
}

export function createScreeningHandler(profiler: Profiler | undefined) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    // The dev server listens on the LAN; only this machine may spend Intercepta quota.
    if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return send(403, { error: "screening is local only" });
    if (req.method !== "GET") return send(405, { error: "GET only" });
    const address = (req.url ?? "").replace(/^\//, "").split("?")[0];
    if (!isAddress(address, { strict: false })) return send(400, { error: "invalid address" });
    send(200, await screenMerchant(profiler, address));
  };
}

export function screeningApi(apiKey: string | undefined): Plugin {
  const profiler = apiKey ? createProfiler(createInterceptaClient({ apiKey, timeoutMs: 7_000 })) : undefined;
  return {
    name: "merchant-screening",
    configureServer(server) {
      server.middlewares.use("/api/screen", createScreeningHandler(profiler));
    },
  };
}
