import { createPublicClient, http, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import type { Address, Profile, Profiler, Reason } from "@eaw/risk";
import { reusableWalletAbi } from "../../../packages/shared/src/abi";

export type Identity = { role: "payer" | "owner" | "agent"; address: Address };
export type PayerLogEntry = { at: string; payer: Address; outcome: "accepted" | "refused"; reasons: Reason[]; profiles: Profile[] };
type Abort = { abort: true; reason: string; message?: string };

/** The minimal on-chain read surface `readIdentitiesWith` needs — small enough to fake in tests. */
export type IdentityRpcClient = {
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
};

/**
 * Everyone who controls or funds the paying wallet: the wallet itself, its owner and the
 * approving agent. Pure function of an `IdentityRpcClient` so the on-chain resolution chain
 * (approvedNonce -> permissionId - 1 -> permissions().agent) can be unit-tested without a network.
 */
export function readIdentitiesWith(client: IdentityRpcClient) {
  return async (payer: Address, nonce: Hex): Promise<Identity[]> => {
    const identities: Identity[] = [{ role: "payer", address: payer }];
    const code = await client.getCode({ address: payer });
    if (!code || code === "0x") return identities;
    const owner = (await client.readContract({ address: payer, abi: reusableWalletAbi, functionName: "owner" })) as Address;
    identities.push({ role: "owner", address: owner });
    const permissionIdPlusOne = (await client.readContract({
      address: payer, abi: reusableWalletAbi, functionName: "approvedNonce", args: [nonce]
    })) as bigint;
    if (permissionIdPlusOne > 0n) {
      const [agent] = (await client.readContract({
        address: payer, abi: reusableWalletAbi, functionName: "permissions", args: [permissionIdPlusOne - 1n]
      })) as readonly [Address, ...unknown[]];
      identities.push({ role: "agent", address: agent });
    }
    return identities;
  };
}

/** Thin viem wrapper: builds a Base Sepolia public client and delegates to `readIdentitiesWith`. */
export function createIdentityReader(rpcUrl: string) {
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  return readIdentitiesWith(client);
}

/**
 * Payee-side gate (x402ResourceServer.onBeforeVerify): screens every identity behind the
 * payer with live Intercepta calls before the facilitator verifies or settles.
 */
export function createPayerGate(deps: {
  profiler: Profiler;
  readIdentities: (payer: Address, nonce: Hex) => Promise<Identity[]>;
  log: PayerLogEntry[];
}) {
  return async (ctx: { paymentPayload: { payload: unknown }; requirements: unknown }): Promise<void | Abort> => {
    const auth = (ctx.paymentPayload.payload as { authorization?: { from?: Address; nonce?: Hex } }).authorization;
    if (!auth?.from || !auth.nonce) return { abort: true, reason: "unsupported_payload" };

    let profiles: Profile[];
    let identities: Identity[];
    try {
      identities = await deps.readIdentities(auth.from, auth.nonce);
      profiles = await Promise.all(identities.map(i => deps.profiler.getProfile(i.address, "payer")));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      deps.log.unshift({ at: new Date().toISOString(), payer: auth.from, outcome: "refused", profiles: [],
        reasons: [{ source: "screening", code: "screening_unavailable", detail }] });
      return { abort: true, reason: `payer_screening_unavailable: ${detail}` };
    }

    const blocked = profiles.map((p, i) => ({ p, identity: identities[i] })).filter(x => x.p.tier === "BLOCKED");
    if (blocked.length === 0) {
      deps.log.unshift({ at: new Date().toISOString(), payer: auth.from, outcome: "accepted", reasons: [], profiles });
      return;
    }
    const reasons = blocked.flatMap(x => x.p.reasons);
    deps.log.unshift({ at: new Date().toISOString(), payer: auth.from, outcome: "refused", reasons, profiles });
    const summary = blocked.map(x => `${x.identity.role} ${x.identity.address}: ${x.p.reasons.map(r => r.detail).join(", ")}`).join("; ");
    return { abort: true, reason: `payer_refused: ${summary}` };
  };
}
