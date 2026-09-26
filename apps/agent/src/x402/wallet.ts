import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { PermissionState } from "@eaw/risk";
import { reusableWalletAbi } from "../../../../packages/shared/src/abi";
import type { WalletRef } from "./config";
import type { Authorization } from "./guarded-signer";

export function createWalletGateway(rpcUrl: string, agentKey: Hex, ref: WalletRef) {
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account: privateKeyToAccount(agentKey), chain: baseSepolia, transport });

  return {
    async readPermission(): Promise<PermissionState> {
      const [, , maxSpend, spent, expiresAt, maxUses, uses, revoked] = await publicClient.readContract({
        address: ref.wallet, abi: reusableWalletAbi, functionName: "permissions", args: [ref.permissionId]
      });
      return { remaining: revoked ? 0n : maxSpend - spent, usesLeft: revoked ? 0 : maxUses - uses, expiresAt: BigInt(expiresAt) };
    },
    /** Contract re-checks agent, budget, uses, expiry; reverts are surfaced as errors. */
    async approve(auth: Authorization): Promise<Hex> {
      const hash = await walletClient.writeContract({
        address: ref.wallet,
        abi: reusableWalletAbi,
        functionName: "approvePayment",
        args: [ref.permissionId, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce]
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`approvePayment reverted: ${hash}`);
      return hash;
    }
  };
}
