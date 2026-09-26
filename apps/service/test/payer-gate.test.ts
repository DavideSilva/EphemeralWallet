import { describe, expect, it, vi } from "vitest";
import { ScreeningUnavailable, type Profile } from "@eaw/risk";
import { createPayerGate, type PayerLogEntry } from "../src/payer-gate";

const PAYER = "0x1111111111111111111111111111111111111111";
const OWNER = "0x4444444444444444444444444444444444444444";
const NONCE = "0x3333333333333333333333333333333333333333333333333333333333333333";
const payload = { payload: { authorization: { from: PAYER, nonce: NONCE }, signature: "0x" } };
const profile = (address: string, tier: Profile["tier"]): Profile => ({
  address: address as `0x${string}`, tier, toxicScore: 0, labels: [], screenedAt: "t",
  reasons: tier === "BLOCKED" ? [{ source: "payer", code: "sanction_address", detail: "OFAC SDN" }] : []
});

function gate(tiers: Record<string, Profile["tier"]>, log: PayerLogEntry[] = []) {
  return createPayerGate({
    profiler: { getProfile: vi.fn(async (a: `0x${string}`) => profile(a, tiers[a] ?? "TRUSTED")) },
    readIdentities: async () => [{ role: "payer", address: PAYER }, { role: "owner", address: OWNER }],
    log
  });
}

describe("payer gate", () => {
  it("accepts a clean payer and logs it", async () => {
    const log: PayerLogEntry[] = [];
    await expect(gate({}, log)({ paymentPayload: payload, requirements: {} })).resolves.toBeUndefined();
    expect(log[0]).toMatchObject({ payer: PAYER, outcome: "accepted" });
  });

  it("refuses when the wallet owner is blocked, with the reason", async () => {
    const result = await gate({ [OWNER]: "BLOCKED" })({ paymentPayload: payload, requirements: {} });
    expect(result).toMatchObject({ abort: true });
    expect(result && result.reason).toMatch(/payer_refused: owner 0x4444.* OFAC SDN/);
  });

  it("fails closed when screening is unavailable", async () => {
    const g = createPayerGate({
      profiler: { getProfile: vi.fn(async () => { throw new ScreeningUnavailable("quick-scan", "HTTP 503"); }) },
      readIdentities: async () => [{ role: "payer", address: PAYER }],
      log: []
    });
    expect(await g({ paymentPayload: payload, requirements: {} })).toMatchObject({ abort: true, reason: expect.stringMatching(/^payer_screening_unavailable/) });
  });

  it("refuses payloads without an EIP-3009 authorization", async () => {
    expect(await gate({})({ paymentPayload: { payload: {} }, requirements: {} })).toMatchObject({ abort: true, reason: "unsupported_payload" });
  });
});
