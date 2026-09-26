import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterceptaClient, Profiler } from "@eaw/risk";
import { payUrl, type PayContext } from "../src/x402/pay";
import { createStore } from "../src/x402/store";

const WALLET = "0x1111111111111111111111111111111111111111";

function ctx(): PayContext {
  return {
    config: {
      rpcUrl: "http://127.0.0.1:1",
      agentKey: `0x${"11".repeat(32)}`,
      interceptaKey: "k",
      port: 0,
      serviceUrl: "http://service.test",
      uiOrigin: "http://ui.test",
      wallets: { default: { wallet: WALLET, permissionId: 1n } }
    },
    client: {} as InterceptaClient,
    profiler: {} as Profiler,
    store: createStore()
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("payUrl", () => {
  it("records a failed decision instead of throwing when the service is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const c = ctx();
    const decision = await payUrl(c, "http://service.test/dataset", "default");
    expect(decision.status).toBe("failed");
    expect(decision.error).toMatch(/fetch failed/);
    expect(c.store.listDecisions()).toHaveLength(1);
  });

  it("records a failed decision on a garbage PAYMENT-REQUIRED header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": "%%%not-base64-json%%%" } })));
    const decision = await payUrl(ctx(), "http://service.test/dataset", "default");
    expect(decision.status).toBe("failed");
    expect(decision.error).toBeTruthy();
  });
});
