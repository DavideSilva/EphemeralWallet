import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterceptaClient, createProfiler, type Address } from "@eaw/risk";
import { loadAgentConfig } from "./config";
import { payUrl } from "./pay";
import { createStore } from "./store";

const config = loadAgentConfig();
const client = createInterceptaClient({ apiKey: config.interceptaKey });
const ctx = { config, client, profiler: createProfiler(client), store: createStore() };

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
};
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
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
      const body = await readBody(req);
      const target = String(body.url ?? `${config.serviceUrl}/dataset`);
      return json(res, 200, await payUrl(ctx, target, body.wallet === "risky" ? "risky" : "default"));
    }
    const hold = url.pathname.match(/^\/holds\/([^/]+)\/(approve|reject)$/);
    if (req.method === "POST" && hold) {
      const resolved = ctx.store.resolveHold(hold[1], hold[2] === "approve" ? "approved" : "rejected");
      if (resolved.status === "rejected") return json(res, 200, resolved);
      return json(res, 200, await payUrl(ctx, resolved.url, resolved.walletKey, { payTo: resolved.payTo, amount: BigInt(resolved.amount) }));
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}).listen(config.port, () => console.log(`agent daemon on http://localhost:${config.port}`));
