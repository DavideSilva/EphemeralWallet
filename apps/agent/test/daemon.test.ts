import { createServer, get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterceptaClient, Profiler } from "@eaw/risk";
import { createDaemonHandler, type DaemonDeps } from "../src/x402/daemon-handler";
import { createStore, type Decision } from "../src/x402/store";

const WALLET = "0x1111111111111111111111111111111111111111";
const PAYEE = "0x2222222222222222222222222222222222222222";
const UI = "http://ui.test";
const SERVICE = "http://service.test";

let server: Server | undefined;
afterEach(() => new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve())));

async function start(pay: DaemonDeps["pay"] = vi.fn()) {
  const store = createStore();
  server = createServer();
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const deps: DaemonDeps = {
    config: {
      rpcUrl: "http://127.0.0.1:1",
      agentKey: `0x${"11".repeat(32)}`,
      interceptaKey: "k",
      port,
      serviceUrl: SERVICE,
      uiOrigin: UI,
      wallets: { default: { wallet: WALLET, permissionId: 0n } }
    },
    client: {} as InterceptaClient,
    profiler: { getProfile: vi.fn() } as unknown as Profiler,
    store,
    pay,
    walletStatus: async () => ({})
  };
  server.on("request", createDaemonHandler(deps));
  const base = `http://127.0.0.1:${port}`;
  const post = (path: string, init: { origin?: string | null; contentType?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { "content-type": init.contentType ?? "application/json" };
    if (init.origin !== null) headers.origin = init.origin ?? UI;
    return fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(init.body ?? {}) });
  };
  return { base, port, store, deps, post };
}

function heldDecision(store: ReturnType<typeof createStore>) {
  const original = store.addDecision({ url: `${SERVICE}/bulk-dataset`, wallet: WALLET, permissionId: "0", status: "held" });
  const hold = store.addHold({ decisionId: original.id, url: original.url, walletKey: "default", payTo: PAYEE, amount: "300000", reasons: [] });
  return { original, hold };
}

const decisionWith = (store: ReturnType<typeof createStore>, patch: Partial<Decision>) =>
  store.addDecision({ url: `${SERVICE}/bulk-dataset`, wallet: WALLET, permissionId: "0", status: "settled", ...patch });

describe("agent daemon guards", () => {
  it("rejects a POST without an Origin header", async () => {
    const pay = vi.fn();
    const { post } = await start(pay);
    expect((await post("/pay", { origin: null })).status).toBe(403);
    expect(pay).not.toHaveBeenCalled();
  });

  it("rejects a POST from another origin or with a non-JSON content type", async () => {
    const pay = vi.fn();
    const { post } = await start(pay);
    expect((await post("/pay", { origin: "http://evil.test" })).status).toBe(403);
    expect((await post("/pay", { contentType: "text/plain" })).status).toBe(415);
    expect(pay).not.toHaveBeenCalled();
  });

  it("rejects a Host that is not the daemon's loopback address (DNS rebinding)", async () => {
    const { port } = await start();
    const res = await new Promise<number>((resolve, reject) => {
      get({ host: "127.0.0.1", port, path: "/decisions", headers: { host: `evil.test:${port}` } }, r => resolve(r.statusCode ?? 0))
.on("error", reject);
    });
    expect(res).toBe(421);
  });

  it("refuses to pay a URL outside the configured service", async () => {
    const pay = vi.fn();
    const { post } = await start(pay);
    const res = await post("/pay", { body: { url: "http://169.254.169.254/latest" } });
    expect(res.status).toBe(400);
    expect(pay).not.toHaveBeenCalled();
  });

  it("answers preflight with 204 and no body", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/pay`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });
});

describe("agent daemon holds", () => {
  it("pays an approved hold and supersedes the original decision", async () => {
    const pay = vi.fn<DaemonDeps["pay"]>(async ctx => decisionWith(ctx.store, { status: "settled" }));
    const { post, store } = await start(pay);
    const { original, hold } = heldDecision(store);
    const res = await post(`/holds/${hold.id}/approve`);
    expect(res.status).toBe(200);
    expect(pay).toHaveBeenCalledWith(expect.anything(), original.url, "default", { payTo: PAYEE, amount: 300_000n });
    expect(store.getHold(hold.id)?.status).toBe("approved");
    expect(store.listDecisions().find(d => d.id === original.id)?.status).toBe("superseded");
  });

  it("reopens the hold when the payment attempt throws", async () => {
    const { post, store } = await start(vi.fn(async () => { throw new Error("boom"); }));
    const { original, hold } = heldDecision(store);
    expect((await post(`/holds/${hold.id}/approve`)).status).toBe(502);
    expect(store.getHold(hold.id)?.status).toBe("pending");
    expect(store.listDecisions().find(d => d.id === original.id)?.status).toBe("held");
  });

  it("reopens the hold when the payment is recorded as failed, so the owner can retry", async () => {
    const pay = vi.fn<DaemonDeps["pay"]>(async ctx => decisionWith(ctx.store, { status: "failed", error: "fetch failed" }));
    const { post, store } = await start(pay);
    const { original, hold } = heldDecision(store);
    const res = await post(`/holds/${hold.id}/approve`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "fetch failed" });
    expect(store.getHold(hold.id)?.status).toBe("pending");
    expect(store.listDecisions().find(d => d.id === original.id)?.status).toBe("held");

    expect((await post(`/holds/${hold.id}/approve`)).status).toBe(502);
    expect(pay).toHaveBeenCalledTimes(2);
  });

  it("does not reopen a hold whose payment was approved on-chain but not confirmed", async () => {
    const pay = vi.fn<DaemonDeps["pay"]>(async ctx => decisionWith(ctx.store, { status: "unsettled", approveTx: "0xabc" }));
    const { post, store } = await start(pay);
    const { hold } = heldDecision(store);
    expect((await post(`/holds/${hold.id}/approve`)).status).toBe(200);
    expect(store.getHold(hold.id)?.status).toBe("approved");
  });

  it("refuses to approve the same hold twice", async () => {
    const pay = vi.fn<DaemonDeps["pay"]>(async ctx => decisionWith(ctx.store, { status: "settled" }));
    const { post, store } = await start(pay);
    const { hold } = heldDecision(store);
    expect((await post(`/holds/${hold.id}/approve`)).status).toBe(200);
    const again = await post(`/holds/${hold.id}/approve`);
    expect(again.status).toBe(500);
    expect(await again.json()).toEqual({ error: "hold already approved" });
    expect(pay).toHaveBeenCalledTimes(1);
  });

  it("records an owner rejection as a refusal", async () => {
    const pay = vi.fn();
    const { post, store } = await start(pay);
    const { original, hold } = heldDecision(store);
    expect((await post(`/holds/${hold.id}/reject`)).status).toBe(200);
    expect(store.listDecisions().find(d => d.id === original.id)?.status).toBe("refused");
    expect(pay).not.toHaveBeenCalled();
  });
});
