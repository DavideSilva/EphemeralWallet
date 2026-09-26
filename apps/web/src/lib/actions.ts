import { encodeAbiParameters, erc20Abi, parseEventLogs, zeroAddress, type Address } from "viem";
import { sendTransaction, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { approvalHookAbi, missionFactoryAbi, missionWalletAbi, reusableFactoryAbi, reusableWalletAbi } from "@shared/abis";
import { publicClient, wagmiConfig } from "./chain";
import { approvalHook, contracts } from "./config";
import { cardId, type Card, type Held } from "./data";
import { ownerPasskey, passkeyConfig, signWithPasskey, storedPasskey } from "./passkey";

export type IssueInput = {
  kind: "one-time" | "multi-use";
  owner: Address;
  merchant: Address;
  /** Multi-use only: a token (USDC) card for an x402 seller. Its budget moves from the owner into the account. */
  asset?: Address;
  agent: Address;
  budget: bigint;
  maxUses: number;
  validFor: number;
  accountFunding: bigint;
  /** Multi-use only: purchases above this need the owner's approval. */
  approvalThreshold?: bigint;
  /** Approve with the owner's passkey (Touch ID) rather than the owner account. */
  approveWithPasskey?: boolean;
};

async function confirm(hash: `0x${string}`) {
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted");
  return receipt;
}

async function expiry(validFor: number) {
  const block = await publicClient.getBlock();
  const now = Math.max(Math.floor(Date.now() / 1000), Number(block.timestamp));
  return BigInt(now + validFor);
}

export async function issueCard(input: IssueInput): Promise<string> {
  // First, before any other await: Safari only allows the passkey prompt close to the click.
  const passkey = input.approvalThreshold !== undefined && input.approveWithPasskey ? await ownerPasskey() : undefined;
  const { missionFactory, reusableFactory } = contracts();
  const expiresAt = await expiry(input.validFor);

  if (input.kind === "one-time") {
    const receipt = await confirm(
      await writeContract(wagmiConfig, {
        address: missionFactory,
        abi: missionFactoryAbi,
        functionName: "createMission",
        args: [input.agent, input.merchant, input.budget, expiresAt],
        value: input.budget,
      }),
    );
    const [created] = parseEventLogs({ abi: missionFactoryAbi, eventName: "MissionCreated", logs: receipt.logs });
    if (!created) throw new Error("The card was issued but its address could not be read");
    return cardId(created.args.wallet);
  }

  let account = await publicClient.readContract({
    address: reusableFactory,
    abi: reusableFactoryAbi,
    functionName: "lastWallet",
    args: [input.owner],
  });
  if (/^0x0+$/.test(account)) {
    const receipt = await confirm(
      await writeContract(wagmiConfig, {
        address: reusableFactory,
        abi: reusableFactoryAbi,
        functionName: "createWallet",
        value: input.accountFunding,
      }),
    );
    const [created] = parseEventLogs({ abi: reusableFactoryAbi, eventName: "WalletCreated", logs: receipt.logs });
    if (!created) throw new Error("The account was opened but its address could not be read");
    account = created.args.wallet;
  }

  if (input.asset) {
    // The seller is paid from the account's own balance, so the budget goes in first: if that fails (the owner
    // lacks USDC) no card is issued, and if issuing then fails the USDC is still the owner's, in their account.
    await confirm(
      await writeContract(wagmiConfig, { address: input.asset, abi: erc20Abi, functionName: "transfer", args: [account, input.budget] }),
    );
    // The contract only allows the approval plugin on ETH cards (HooksNeedNativePermission).
    const receipt = await confirm(
      await writeContract(wagmiConfig, {
        address: account,
        abi: reusableWalletAbi,
        functionName: "createPermission",
        args: [input.agent, input.merchant, input.budget, expiresAt, input.maxUses, input.asset],
      }),
    );
    const [created] = parseEventLogs({ abi: reusableWalletAbi, eventName: "PermissionCreated", logs: receipt.logs });
    if (!created) throw new Error("The card was issued but its number could not be read");
    return cardId(account, created.args.permissionId);
  }

  const hook = approvalHook();
  if (input.approvalThreshold !== undefined && !hook) throw new Error("The approval plugin isn't deployed. Restart the demo.");
  const receipt = await confirm(
    input.approvalThreshold !== undefined
      ? await writeContract(wagmiConfig, {
          address: account,
          abi: reusableWalletAbi,
          functionName: "createPermissionWithHooks",
          args: [
            input.agent,
            input.merchant,
            input.budget,
            expiresAt,
            input.maxUses,
            zeroAddress,
            [
              {
                hook: hook!,
                config: passkey
                  ? passkeyConfig(input.approvalThreshold, passkey)
                  : encodeAbiParameters([{ type: "uint256" }], [input.approvalThreshold]),
              },
            ],
          ],
        })
      : await writeContract(wagmiConfig, {
          address: account,
          abi: reusableWalletAbi,
          functionName: "createPermission",
          args: [input.agent, input.merchant, input.budget, expiresAt, input.maxUses, zeroAddress],
        }),
  );
  const [created] = parseEventLogs({ abi: reusableWalletAbi, eventName: "PermissionCreated", logs: receipt.logs });
  if (!created) throw new Error("The card was issued but its number could not be read");
  return cardId(account, created.args.permissionId);
}

export async function cancelCard(card: Card) {
  const hash =
    card.kind === "one-time"
      ? await writeContract(wagmiConfig, { address: card.wallet, abi: missionWalletAbi, functionName: "cancel" })
      : await writeContract(wagmiConfig, {
          address: card.wallet,
          abi: reusableWalletAbi,
          functionName: "revokePermission",
          args: [card.permissionId!],
        });
  await confirm(hash);
}

export async function reclaimCard(card: Card) {
  await confirm(
    await writeContract(wagmiConfig, { address: card.wallet, abi: missionWalletAbi, functionName: "reclaim" }),
  );
}

export async function topUp(account: Address, amount: bigint) {
  await confirm(await sendTransaction(wagmiConfig, { to: account, value: amount }));
}

/** Moves a token (USDC) from the account back to the owner: what's left of cancelled, expired or used-up cards. */
export async function withdrawToken(account: Address, asset: Address, amount: bigint) {
  await confirm(
    await writeContract(wagmiConfig, { address: account, abi: reusableWalletAbi, functionName: "withdrawToken", args: [asset, amount] }),
  );
}

/**
 * The passkey challenge for a held purchase, with the expiry it signs (an hour from the later of wall clock and chain
 * time). Read ahead of the click so Touch ID opens straight away; the caller refreshes it well within the hour.
 */
export async function approvalChallenge(held: Held) {
  const block = await publicClient.getBlock();
  const validUntil = BigInt(Math.max(Math.floor(Date.now() / 1000), Number(block.timestamp)) + 60 * 60);
  const challenge = await publicClient.readContract({
    address: held.hook,
    abi: approvalHookAbi,
    functionName: "challenge",
    args: [held.wallet, held.permissionId, held.target, held.value, held.data, validUntil],
  });
  return { validUntil, challenge };
}

/**
 * Touch ID signs this exact purchase, and the signature is recorded on-chain. The owner account only relays it:
 * the plugin checks the passkey signature, so the account alone couldn't approve.
 */
export async function approveWithPasskey(
  held: Held,
  { validUntil, challenge }: { validUntil: bigint; challenge: `0x${string}` },
) {
  const passkey = storedPasskey();
  if (!passkey) throw new Error("This browser doesn't have the passkey this card was issued with.");
  const auth = await signWithPasskey(passkey, challenge);
  await confirm(
    await writeContract(wagmiConfig, {
      address: held.hook,
      abi: approvalHookAbi,
      functionName: "approveWithPasskey",
      args: [held.wallet, held.permissionId, held.target, held.value, held.data, validUntil, auth],
    }),
  );
}

/** The owner account approves one held purchase for the next hour; the waiting agent then retries it. */
export async function approvePurchase(held: Held) {
  const block = await publicClient.getBlock();
  const validUntil = BigInt(Math.max(Math.floor(Date.now() / 1000), Number(block.timestamp)) + 60 * 60);
  await confirm(
    await writeContract(wagmiConfig, {
      address: held.hook,
      abi: approvalHookAbi,
      functionName: "approve",
      args: [held.wallet, held.permissionId, held.target, held.value, held.data, validUntil],
    }),
  );
}
