import { decodeErrorResult, decodeFunctionData, type Hex } from "viem";
import { merchantAbi, missionWalletAbi, reusableWalletAbi } from "./abis";

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
};

const walletErrors = [...missionWalletAbi, ...reusableWalletAbi].filter(item => item.type === "error");
const merchantErrors = merchantAbi.filter(item => item.type === "error");

export function describeRevert(data: Hex | undefined): string {
  if (!data || data === "0x") return "Rejected by the card";
  try {
    const decoded = decodeErrorResult({ abi: walletErrors, data });
    if (decoded.errorName === "CallFailed") {
      const inner = decoded.args?.[0] as Hex | undefined;
      try {
        const merchant = decodeErrorResult({ abi: merchantErrors, data: inner ?? "0x" });
        return reasons[merchant.errorName] ?? merchant.errorName;
      } catch {
        return "Merchant rejected the purchase";
      }
    }
    return reasons[decoded.errorName] ?? decoded.errorName;
  } catch {
    return "Rejected by the card";
  }
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
