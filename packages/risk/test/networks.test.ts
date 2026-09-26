import { describe, expect, it } from "vitest";
import { BASE_MAINNET_USDC, isCanonicalUsdc, screeningTokenAddress, toScreeningTypedData } from "../src/networks";

describe("networks", () => {
  it("recognises canonical Base Sepolia USDC case-insensitively", () => {
    expect(isCanonicalUsdc("0x036cbd53842c5426634e7929541ec2318f3dcf7e")).toBe(true);
    expect(isCanonicalUsdc("0x0000000000000000000000000000000000000001")).toBe(false);
  });

  it("maps canonical USDC to mainnet and leaves lookalikes untouched", () => {
    expect(screeningTokenAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e")).toBe(BASE_MAINNET_USDC);
    expect(screeningTokenAddress("0x0000000000000000000000000000000000000001")).toBe("0x0000000000000000000000000000000000000001");
  });

  it("rewrites the EIP-712 domain to Base mainnet for screening", () => {
    const typed = toScreeningTypedData({
      domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
      types: {}, primaryType: "TransferWithAuthorization", message: { value: 5n }
    });
    expect(typed.domain.chainId).toBe(8453);
    expect(typed.domain.verifyingContract).toBe(BASE_MAINNET_USDC);
    expect(typed.message.value).toBe("5");
  });
});
