import { describe, expect, it } from "vitest";
import { encodeErrorResult } from "viem";
import { merchantAbi, reusableWalletAbi } from "../../../packages/shared/src/abis";
import { decodeRevert, describeRevert, revertName } from "../../../packages/shared/src/revert";

const HOOK = "0x3333333333333333333333333333333333333333";

describe("revert decoding", () => {
  it("names built-in wallet errors", () => {
    const data = encodeErrorResult({ abi: reusableWalletAbi, errorName: "SpendLimitExceeded" });
    expect(revertName(data)).toBe("SpendLimitExceeded");
    expect(describeRevert(data)).toBe("Over the card's budget");
  });

  it("unwraps merchant errors from CallFailed", () => {
    const inner = encodeErrorResult({ abi: merchantAbi, errorName: "WrongPayment" });
    const data = encodeErrorResult({ abi: reusableWalletAbi, errorName: "CallFailed", args: [inner] });
    expect(revertName(data)).toBe("WrongPayment");
  });

  it("reports the plugin behind HookRejected, even when its error is unknown", () => {
    const data = encodeErrorResult({ abi: reusableWalletAbi, errorName: "HookRejected", args: [HOOK, "0x12345678"] });
    expect(decodeRevert(data)).toEqual({ name: "HookRejected", hook: HOOK });
    expect(describeRevert(data)).toBe("Held by a card plugin");
  });

  it("falls back for empty or unknown data", () => {
    expect(revertName("0x")).toBeUndefined();
    expect(describeRevert("0xdeadbeef")).toBe("Rejected by the card");
  });
});
