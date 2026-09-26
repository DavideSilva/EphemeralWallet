import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { InterceptaClient, Profiler, ScreeningResult } from "@eaw/risk";
import { payUrl, type PayContext } from "../src/x402/pay";
import { createStore } from "../src/x402/store";

const WALLET = "0x1111111111111111111111111111111111111111";
const PAYEE = "0x2222222222222222222222222222222222222222";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const clean: ScreeningResult = {
  payee: { address: PAYEE, tier: "TRUSTED", toxicScore: 0, reasons: [], labels: [], screenedAt: "t" },
  token: { riskLevel: "neutral", trust: "whitelist", action: "info", detectors: [] },
  message: { riskGroup: "Low", detectors: [] },
  tokenIsCanonical: true,
  unavailable: []
};
const chain = vi.hoisted(() => ({ approve: vi.fn(), screening: undefined as unknown }));
vi.mock("../src/x402/screen", () => ({ createScreener: () => async () => chain.screening }));
vi.mock("../src/x402/wallet", () => ({
  createWalletGateway: () => ({
    readPermission: async () => ({ remaining: 1_000_000n, usesLeft: 5, expiresAt: 4_000_000_000n }),
    approve: chain.approve
  })
}));

beforeEach(() => {
  chain.screening = clean;
  chain.approve.mockReset().mockResolvedValue("0xabc");
});

const required = (amount: string, error?: string) =>
  encodePaymentRequiredHeader({
    x402Version: 2,
    error,
    resource: { url: "http://service.test/dataset", description: "d", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: "eip155:84532", amount, asset: USDC, payTo: PAYEE, maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" } }]
  });

/** First call answers 402 with `amount`; the paid retry answers with `paid`. */
function service(amount: string, paid: () => Response) {
  return vi.fn(async (_url: string, init?: RequestInit) =>
    (init?.headers as Record<string, string> | undefined)?.["PAYMENT-SIGNATURE"]
      ? paid()
      : new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": required(amount) } })
  );
}

function ctx(): PayContext {
  return {
    config: {
      rpcUrl: "http://127.0.0.1:1",
      agentKey: `0x${"11".repeat(32)}`,
      interceptaKey: "k",
      port: 0,
      serviceUrl: "http://service.test",
      weatherUrl: "http://weather.test",
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

  it("records a redirect as failed without following it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://evil.test" } })));
    const decision = await payUrl(ctx(), "http://service.test/dataset", "default");
    expect(decision).toMatchObject({ status: "failed", error: "expected 402, got 302" });
  });

  it("links a held payment to the hold it created, without approving", async () => {
    vi.stubGlobal("fetch", service("300000", () => new Response(null, { status: 500 })));
    const c = ctx();
    const decision = await payUrl(c, "http://service.test/dataset", "default");
    expect(decision.status).toBe("held");
    const [hold] = c.store.listHolds();
    expect(decision.holdId).toBe(hold.id);
    expect(hold).toMatchObject({ decisionId: decision.id, payTo: PAYEE, amount: "300000", status: "pending" });
    expect(chain.approve).not.toHaveBeenCalled();
  });

  it("records the seller's payer screening refusal as rejected_by_payee", async () => {
    const refusal = () =>
      new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": required("10000", "payer_refused: owner 0x4444444444444444444444444444444444444444: OFAC SDN") } });
    vi.stubGlobal("fetch", service("10000", refusal));
    const decision = await payUrl(ctx(), "http://service.test/dataset", "default");
    expect(decision).toMatchObject({ status: "rejected_by_payee", approveTx: "0xabc" });
    expect(decision.error).toMatch(/^payer_refused/);
  });

  it("records an approved payment that did not settle as unsettled, with its expiry", async () => {
    vi.stubGlobal("fetch", service("10000", () => new Response(null, { status: 500 })));
    const c = ctx();
    const decision = await payUrl(c, "http://service.test/dataset", "default");
    expect(decision).toMatchObject({ status: "unsettled", approveTx: "0xabc", error: "HTTP 500" });
    expect(Number(decision.validBefore)).toBeGreaterThan(Date.now() / 1000);
    expect(c.store.paidBefore(PAYEE)).toBe(false);
  });

  it("records a settled payment", async () => {
    vi.stubGlobal("fetch", service("10000", () => new Response("{}", { status: 200 })));
    const c = ctx();
    const decision = await payUrl(c, "http://service.test/dataset", "default");
    expect(decision.status).toBe("settled");
    expect(c.store.paidBefore(PAYEE)).toBe(true);
  });
});
