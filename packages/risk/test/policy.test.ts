import { describe, expect, it } from "vitest";
import { decide, DEFAULT_POLICY, type DecideInput } from "../src/policy";
import type { Profile } from "../src/profile";

const profile = (tier: Profile["tier"], reasons: Profile["reasons"] = []): Profile => ({
  address: "0x00000000000000000000000000000000000000aa", tier, toxicScore: 0, reasons, labels: [], screenedAt: "t"
});

function input(overrides: Partial<DecideInput> = {}, screening: Partial<DecideInput["screening"]> = {}): DecideInput {
  return {
    amount: 10_000n,
    screening: {
      payee: profile("TRUSTED"),
      token: { riskLevel: "neutral", trust: "whitelist", action: "info", detectors: [] },
      message: { riskGroup: "Low", detectors: [] },
      tokenIsCanonical: true,
      unavailable: [],
      ...screening
    },
    permission: { remaining: 1_000_000n, usesLeft: 5, expiresAt: 2_000n },
    now: 1_000n,
    paidBefore: true,
    humanApproved: false,
    config: DEFAULT_POLICY,
    ...overrides
  };
}

describe("decide", () => {
  it("pays a clean counterparty", () => expect(decide(input()).kind).toBe("PAY"));

  it("refuses when screening is unavailable (fail closed)", () => {
    const v = decide(input({}, { unavailable: ["quick-scan: HTTP 500"] }));
    expect(v.kind).toBe("REFUSE");
    expect(v.reasons[0]).toMatchObject({ source: "screening", code: "screening_unavailable" });
  });

  it("refuses a blocked payee and carries its reasons", () => {
    const reasons = [{ source: "payee" as const, code: "sanction_address", detail: "OFAC" }];
    const v = decide(input({}, { payee: profile("BLOCKED", reasons) }));
    expect(v).toMatchObject({ kind: "REFUSE", reasons });
  });

  it("refuses a lookalike token", () => {
    expect(decide(input({}, { tokenIsCanonical: false })).reasons[0].code).toBe("non_canonical_token");
  });

  it("refuses a blocklisted token", () => {
    const token = { riskLevel: "high" as const, trust: "blocklist" as const, action: "block" as const, detectors: [{ code: "FAKE_TOKEN", description: "fake" }] };
    expect(decide(input({}, { token })).reasons[0].code).toBe("FAKE_TOKEN");
  });

  it("refuses a high-risk authorization", () => {
    const message = { riskGroup: "High" as const, detectors: [{ code: "WALLET_DRAINER", description: "drainer" }] };
    expect(decide(input({}, { message }))).toMatchObject({ kind: "REFUSE", reasons: [{ code: "WALLET_DRAINER" }] });
  });

  it("refuses over budget, exhausted or expired permissions", () => {
    expect(decide(input({ amount: 2_000_000n })).reasons[0].code).toBe("over_budget");
    expect(decide(input({ permission: { remaining: 1_000_000n, usesLeft: 0, expiresAt: 2_000n } })).reasons[0].code).toBe("no_uses_left");
    expect(decide(input({ now: 3_000n })).reasons[0].code).toBe("permission_expired");
  });

  it("holds a medium-risk authorization", () => {
    expect(decide(input({}, { message: { riskGroup: "Medium", detectors: [] } })).kind).toBe("HOLD");
  });

  it("caps a CAUTION payee at capBps of the remaining budget", () => {
    const v = decide(input({ amount: 100_000n }, { payee: profile("CAUTION") }));
    expect(v).toMatchObject({ kind: "CAP", cap: 200_000n });
  });

  it("holds a CAUTION payee above the cap", () => {
    expect(decide(input({ amount: 300_000n }, { payee: profile("CAUTION") })).kind).toBe("HOLD");
  });

  it("holds large payments and large first payments", () => {
    expect(decide(input({ amount: 300_000n })).reasons[0].code).toBe("above_hold_threshold");
    expect(decide(input({ amount: 150_000n, paidBefore: false })).reasons[0].code).toBe("first_payment_to_payee");
  });

  it("owner approval clears HOLD/CAP but never REFUSE", () => {
    expect(decide(input({ amount: 300_000n, humanApproved: true })).kind).toBe("PAY");
    expect(decide(input({ humanApproved: true }, { payee: profile("BLOCKED") })).kind).toBe("REFUSE");
  });
});
