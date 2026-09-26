import { describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, size } from "viem";
import { DEFAULT_POLICY, type ScreeningResult } from "@eaw/risk";
import { createGuardedSigner, PaymentBlocked, type GuardDeps } from "../src/x402/guarded-signer";

const WALLET = "0x1111111111111111111111111111111111111111";
const PAYEE = "0x2222222222222222222222222222222222222222";
const NONCE = "0x3333333333333333333333333333333333333333333333333333333333333333";

const clean: ScreeningResult = {
  payee: { address: PAYEE, tier: "TRUSTED", toxicScore: 0, reasons: [], labels: [], screenedAt: "t" },
  token: { riskLevel: "neutral", trust: "whitelist", action: "info", detectors: [] },
  message: { riskGroup: "Low", detectors: [] },
  tokenIsCanonical: true,
  unavailable: []
};

const typedData = (value: bigint, from = WALLET) => ({
  domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
  types: {},
  primaryType: "TransferWithAuthorization",
  message: { from, to: PAYEE, value, validAfter: 0n, validBefore: 1_900_000_000n, nonce: NONCE }
});

function deps(overrides: Partial<GuardDeps> = {}): GuardDeps {
  return {
    wallet: WALLET,
    permissionId: 7n,
    config: DEFAULT_POLICY,
    screen: vi.fn(async () => clean),
    readPermission: vi.fn(async () => ({ remaining: 1_000_000n, usesLeft: 5, expiresAt: 2_000_000_000n })),
    approve: vi.fn(async () => "0xabc" as const),
    paidBefore: () => true,
    onVerdict: vi.fn(),
    now: () => 1_000n,
    ...overrides
  };
}

describe("guarded signer", () => {
  it("screens, approves on-chain and returns a >65-byte wallet signature", async () => {
    const d = deps();
    const sig = await createGuardedSigner(d).signTypedData(typedData(10_000n));
    expect(size(sig)).toBe(96);
    expect(decodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }], sig)[0]).toBe(7n);
    expect(d.approve).toHaveBeenCalledWith(expect.objectContaining({ to: PAYEE, value: 10_000n, nonce: NONCE }));
    expect(d.onVerdict).toHaveBeenCalledWith(expect.objectContaining({ verdict: expect.objectContaining({ kind: "PAY" }), approveTx: "0xabc" }));
  });

  it("refuses without touching the chain when the payee is blocked", async () => {
    const d = deps({ screen: vi.fn(async () => ({ ...clean, payee: { ...clean.payee!, tier: "BLOCKED" as const } })) });
    await expect(createGuardedSigner(d).signTypedData(typedData(10_000n))).rejects.toBeInstanceOf(PaymentBlocked);
    expect(d.approve).not.toHaveBeenCalled();
  });

  it("holds large payments and does not approve", async () => {
    const d = deps();
    const err = await createGuardedSigner(d).signTypedData(typedData(300_000n)).catch(e => e);
    expect(err).toBeInstanceOf(PaymentBlocked);
    expect((err as PaymentBlocked).verdict.kind).toBe("HOLD");
    expect(d.approve).not.toHaveBeenCalled();
  });

  it("pays a held payment once the owner approved exactly that payee and amount", async () => {
    const d = deps({ approvedFor: { payTo: PAYEE, amount: 300_000n } });
    await createGuardedSigner(d).signTypedData(typedData(300_000n));
    expect(d.approve).toHaveBeenCalled();
  });

  it("ignores an owner approval for a different amount", async () => {
    const d = deps({ approvedFor: { payTo: PAYEE, amount: 300_000n } });
    await expect(createGuardedSigner(d).signTypedData(typedData(400_000n))).rejects.toBeInstanceOf(PaymentBlocked);
  });

  it("rejects typed data that is not a transfer from this wallet", async () => {
    const d = deps();
    await expect(createGuardedSigner(d).signTypedData(typedData(1n, PAYEE))).rejects.toThrow(/not from this wallet/);
    await expect(createGuardedSigner(d).signTypedData({ ...typedData(1n), primaryType: "Permit" })).rejects.toThrow(/unsupported/);
  });
});
