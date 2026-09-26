import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { ScreeningUnavailable, type Address, type Profile } from "@eaw/risk";
import { createPayerGate, readIdentitiesWith, type IdentityRpcClient, type PayerLogEntry } from "../src/payer-gate";

const PAYER = "0x1111111111111111111111111111111111111111";
const OWNER = "0x4444444444444444444444444444444444444444";
const AGENT = "0x5555555555555555555555555555555555555555";
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

function fakeRpcClient(opts: { code?: Hex; owner?: Address; approvedNonce?: bigint; agent?: Address }): IdentityRpcClient {
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === "owner") return opts.owner;
    if (functionName === "approvedNonce") return opts.approvedNonce ?? 0n;
    if (functionName === "permissions") return [opts.agent, opts.owner, 0n, 0n, 0n, 0, 0, false, opts.owner] as const;
    throw new Error(`unexpected functionName: ${functionName}`);
  });
  return { getCode: vi.fn(async () => opts.code), readContract };
}

describe("readIdentitiesWith", () => {
  it.each([["0x" as Hex], [undefined]])("resolves only the payer for an EOA wallet (getCode -> %s)", async code => {
    const client = fakeRpcClient({ code });
    const identities = await readIdentitiesWith(client)(PAYER, NONCE);
    expect(identities).toEqual([{ role: "payer", address: PAYER }]);
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it("resolves payer + owner for a contract wallet with no approved nonce for this payment", async () => {
    const client = fakeRpcClient({ code: "0xabc", owner: OWNER, approvedNonce: 0n });
    const identities = await readIdentitiesWith(client)(PAYER, NONCE);
    expect(identities).toEqual([
      { role: "payer", address: PAYER },
      { role: "owner", address: OWNER }
    ]);
  });

  it("resolves the approving agent from permissions(approvedNonce - 1)", async () => {
    const client = fakeRpcClient({ code: "0xabc", owner: OWNER, approvedNonce: 3n, agent: AGENT });
    const identities = await readIdentitiesWith(client)(PAYER, NONCE);
    expect(identities).toEqual([
      { role: "payer", address: PAYER },
      { role: "owner", address: OWNER },
      { role: "agent", address: AGENT }
    ]);
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "permissions", args: [2n] }));
  });
});
