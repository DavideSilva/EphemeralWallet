import { decodeErrorResult, decodeFunctionData, type Abi, type Address, type Hex } from "viem";
import { approvalHookAbi, merchantAbi, missionWalletAbi, reusableWalletAbi } from "./abis";

const reasons: Record<string, string> = {
  NotOwner: "Only the owner can do this",
  NotAgent: "Not this card's agent",
  MissionAlreadyUsed: "Card already used",
  MissionExpired: "Card expired",
  PermissionExpired: "Card expired",
  MissionCancelled: "Card cancelled",
  PermissionIsRevoked: "Card cancelled",
  PermissionExhausted: "No uses left",
  PermissionNotFound: "Card not found",
  InvalidTarget: "Merchant not allowed on this card",
  SpendLimitExceeded: "Over the card's budget",
  UnknownItem: "Item not in the merchant's catalog",
  InvalidQuantity: "Quantity must be at least 1",
  WrongPayment: "Payment didn't match the catalog price",
  CallFailed: "Merchant rejected the purchase",
  HookRejected: "Held by a card plugin",
  ApprovalRequired: "Waiting for your approval",
  Reentered: "Rejected by the card",
};

const walletErrors = [...missionWalletAbi, ...reusableWalletAbi].filter(item => item.type === "error");
const merchantErrors = merchantAbi.filter(item => item.type === "error");
// Errors that card plugins revert with. The wallet wraps them in HookRejected(hook, reason).
const hookErrors: Abi = approvalHookAbi.filter(item => item.type === "error");

export type DecodedRevert = {
  /** The innermost error name: the merchant's or plugin's own error when the wallet wrapped one. */
  name: string;
  args?: readonly unknown[];
  /** The plugin that held the purchase, for HookRejected. */
  hook?: Address;
};

export function decodeRevert(data: Hex | undefined): DecodedRevert | undefined {
  if (!data || data === "0x") return undefined;
  let decoded;
  try {
    decoded = decodeErrorResult({ abi: walletErrors, data });
  } catch {
    return undefined;
  }
  if (decoded.errorName === "CallFailed") {
    try {
      const merchant = decodeErrorResult({ abi: merchantErrors, data: (decoded.args?.[0] as Hex | undefined) ?? "0x" });
      return { name: merchant.errorName, args: merchant.args };
    } catch {
      return { name: "CallFailed" };
    }
  }
  if (decoded.errorName === "HookRejected") {
    const [hook, reason] = decoded.args as readonly [Address, Hex];
    try {
      const inner = decodeErrorResult({ abi: hookErrors, data: reason });
      return { name: inner.errorName, args: inner.args, hook };
    } catch {
      return { name: "HookRejected", hook };
    }
  }
  return { name: decoded.errorName, args: decoded.args };
}

/** The error name behind a revert, for code that branches on it. Never branch on describeRevert's text. */
export function revertName(data: Hex | undefined): string | undefined {
  return decodeRevert(data)?.name;
}

export function describeRevert(data: Hex | undefined): string {
  const decoded = decodeRevert(data);
  if (!decoded) return "Rejected by the card";
  return reasons[decoded.name] ?? decoded.name;
}

type RawRequest = (args: { method: string; params: unknown[] }) => Promise<unknown>;

export async function revertData(request: unknown, hash: Hex): Promise<Hex | undefined> {
  const trace = (await (request as RawRequest)({
    method: "debug_traceTransaction",
    params: [hash, { tracer: "callTracer" }],
  })) as { output?: Hex };
  return trace.output;
}

export function decodePurchase(data: Hex): { itemId: bigint; quantity: bigint } | undefined {
  try {
    const decoded = decodeFunctionData({ abi: merchantAbi, data });
    if (decoded.functionName !== "buy") return undefined;
    const [itemId, quantity] = decoded.args;
    return { itemId, quantity };
  } catch {
    return undefined;
  }
}
