import { parseEventLogs, zeroAddress, type Address } from "viem";
import { sendTransaction, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { missionFactoryAbi, missionWalletAbi, reusableFactoryAbi, reusableWalletAbi } from "@shared/abis";
import { publicClient, wagmiConfig } from "./chain";
import { contracts } from "./config";
import { cardId, type Card } from "./data";

export type IssueInput = {
  kind: "one-time" | "multi-use";
  owner: Address;
  merchant: Address;
  agent: Address;
  budget: bigint;
  maxUses: number;
  validFor: number;
  accountFunding: bigint;
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

  const receipt = await confirm(
    await writeContract(wagmiConfig, {
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
