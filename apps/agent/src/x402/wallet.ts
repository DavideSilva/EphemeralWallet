import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { PermissionState } from "@eaw/risk";
import { approvalHookAbi, erc20Abi, reusableWalletAbi } from "../../../../packages/shared/src/abi";
import { decodeRevert } from "../../../../packages/shared/src/revert";
import type { WalletRef } from "./config";
import { NeedsTouchId, type Authorization, type OwnerApproval } from "./guarded-signer";

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
    /** Read-only snapshot for the UI: the permission's limits and the wallet's token balance (6 decimals). */
    async readStatus() {
      const [, , maxSpend, spent, expiresAt, maxUses, uses, revoked, asset] = await publicClient.readContract({
        address: ref.wallet, abi: reusableWalletAbi, functionName: "permissions", args: [ref.permissionId]
      });
      const balance = await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [ref.wallet] });
      return {
        wallet: ref.wallet,
        permissionId: ref.permissionId.toString(),
        maxSpend: maxSpend.toString(),
        spent: spent.toString(),
        balance: balance.toString(),
        uses,
        maxUses,
        expiresAt: Number(expiresAt),
        revoked
      };
    },
    /** The approval plugin on this permission, if any (the first hook that answers needsApproval). */
    async ownerApproval(auth: Authorization): Promise<OwnerApproval> {
      const hooks = await publicClient.readContract({ address: ref.wallet, abi: reusableWalletAbi, functionName: "hooksOf", args: [ref.permissionId] });
      for (const { hook } of hooks) {
        const read = <F extends "needsApproval" | "knownPayee">(functionName: F, args: readonly unknown[]) =>
          publicClient.readContract({ address: hook, abi: approvalHookAbi, functionName, args } as never) as Promise<boolean>;
        let required: boolean;
        try {
          required = await read("needsApproval", [ref.wallet, ref.permissionId, auth.to, auth.value]);
        } catch {
          continue; // not an approval plugin
        }
        if (!required) return { required: false };
        const key = await publicClient.readContract({
          address: hook, abi: approvalHookAbi, functionName: "requestKey", args: [ref.wallet, ref.permissionId, auth.to, auth.value, "0x"]
        });
        const [until, block, known] = await Promise.all([
          publicClient.readContract({ address: hook, abi: approvalHookAbi, functionName: "approvedUntil", args: [key] }),
          publicClient.getBlock(),
          read("knownPayee", [ref.wallet, ref.permissionId, auth.to])
        ]);
        return { required: true, approved: until >= block.timestamp, reason: known ? "over_threshold" : "new_payee" };
      }
      return { required: false };
    },
    /** Contract re-checks agent, budget, uses, expiry and plugins; reverts are surfaced as errors. */
    async approve(auth: Authorization): Promise<Hex> {
      const args = [ref.permissionId, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce] as const;
      // Simulate first so a plugin's refusal comes back as a readable reason, not a bare reverted transaction.
      try {
        await publicClient.simulateContract({ account: walletClient.account, address: ref.wallet, abi: reusableWalletAbi, functionName: "approvePayment", args });
      } catch (error) {
        const reverted = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : undefined;
        const data = reverted instanceof ContractFunctionRevertedError ? reverted.raw : undefined;
        if (decodeRevert(data)?.name === "ApprovalRequired") throw new NeedsTouchId();
        throw error;
      }
      const hash = await walletClient.writeContract({
        address: ref.wallet,
        abi: reusableWalletAbi,
        functionName: "approvePayment",
        args
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`approvePayment reverted: ${hash}`);
      return hash;
    }
  };
}
