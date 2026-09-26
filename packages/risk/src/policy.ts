import type { Profile } from "./profile";
import type { MessageScan, Reason, TokenScan } from "./types";

export type VerdictKind = "PAY" | "CAP" | "HOLD" | "REFUSE";
export type Verdict = { kind: VerdictKind; reasons: Reason[]; cap?: bigint };
export type PolicyConfig = { holdAbove: bigint; firstPaymentHoldAbove: bigint; capBps: number };
export type PermissionState = { remaining: bigint; usesLeft: number; expiresAt: bigint };
export type ScreeningResult = {
  payee?: Profile;
  token?: TokenScan;
  message?: MessageScan;
  tokenIsCanonical: boolean;
  unavailable: string[];
};
export type DecideInput = {
  amount: bigint;
  screening: ScreeningResult;
  permission: PermissionState;
  now: bigint;
  paidBefore: boolean;
  humanApproved: boolean;
  config: PolicyConfig;
};

/** USDC has 6 decimals: 250_000n = 0.25 USDC. */
export const DEFAULT_POLICY: PolicyConfig = { holdAbove: 250_000n, firstPaymentHoldAbove: 100_000n, capBps: 2000 };

const usdc = (amount: bigint) => `${Number(amount) / 1e6} USDC`;
const refuse = (reasons: Reason[]): Verdict => ({ kind: "REFUSE", reasons });

/** Pure decision: first matching rule wins. REFUSE rules run before owner approval is considered. */
export function decide(input: DecideInput): Verdict {
  const { amount, screening, permission, config } = input;

  if (screening.unavailable.length > 0 || !screening.payee || !screening.token || !screening.message) {
    const detail = screening.unavailable.join("; ") || "incomplete screening";
    return refuse([{ source: "screening", code: "screening_unavailable", detail: `Intercepta unavailable, failing closed: ${detail}` }]);
  }
  const { payee, token, message } = screening;

  if (payee.tier === "BLOCKED") return refuse(payee.reasons);
  if (!screening.tokenIsCanonical) {
    return refuse([{ source: "token", code: "non_canonical_token", detail: "Asset is not canonical USDC (possible lookalike)" }]);
  }
  if (token.action === "block" || token.trust === "blocklist" || token.riskLevel === "high") {
    return refuse(
      token.detectors.length
        ? token.detectors.map(d => ({ source: "token" as const, code: d.code, detail: d.description }))
        : [{ source: "token", code: "token_high_risk", detail: `Token risk level ${token.riskLevel}` }]
    );
  }
  if (message.riskGroup === "High") {
    return refuse(
      message.detectors.length
        ? message.detectors.map(d => ({ source: "authorization" as const, code: d.code, detail: d.description }))
        : [{ source: "authorization", code: "authorization_high_risk", detail: "Payment authorization rated High risk" }]
    );
  }
  if (amount > permission.remaining) {
    return refuse([{ source: "limits", code: "over_budget", detail: `${usdc(amount)} exceeds remaining ${usdc(permission.remaining)}` }]);
  }
  if (permission.usesLeft <= 0) return refuse([{ source: "limits", code: "no_uses_left", detail: "Permission has no uses left" }]);
  if (input.now > permission.expiresAt) return refuse([{ source: "limits", code: "permission_expired", detail: "Permission expired" }]);

  if (input.humanApproved) return { kind: "PAY", reasons: [{ source: "owner", code: "owner_approved", detail: "Approved by wallet owner" }] };

  if (message.riskGroup === "Medium") {
    return {
      kind: "HOLD",
      reasons: message.detectors.length
        ? message.detectors.map(d => ({ source: "authorization" as const, code: d.code, detail: d.description }))
        : [{ source: "authorization", code: "authorization_medium_risk", detail: "Payment authorization rated Medium risk" }]
    };
  }
  if (payee.tier === "CAUTION") {
    const cap = (permission.remaining * BigInt(config.capBps)) / 10_000n;
    const capReason: Reason = { source: "limits", code: "counterparty_cap", detail: `Caution payee: capped at ${usdc(cap)}` };
    if (amount <= cap) return { kind: "CAP", cap, reasons: [...payee.reasons, capReason] };
    return { kind: "HOLD", cap, reasons: [...payee.reasons, { ...capReason, detail: `${usdc(amount)} exceeds caution cap ${usdc(cap)}` }] };
  }
  if (amount > config.holdAbove) {
    return { kind: "HOLD", reasons: [{ source: "limits", code: "above_hold_threshold", detail: `${usdc(amount)} is above the ${usdc(config.holdAbove)} approval threshold` }] };
  }
  if (!input.paidBefore && amount > config.firstPaymentHoldAbove) {
    return { kind: "HOLD", reasons: [{ source: "payee", code: "first_payment_to_payee", detail: `First payment to this payee above ${usdc(config.firstPaymentHoldAbove)}` }] };
  }
  return {
    kind: "PAY",
    reasons: [{ source: "payee", code: "clean", detail: "Payee has no risk traits; canonical USDC; authorization Low risk" }]
  };
}
