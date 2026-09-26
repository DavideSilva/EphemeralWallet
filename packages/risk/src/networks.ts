import type { Address, TypedDataPayload } from "./types";

export const BASE_SEPOLIA_USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const BASE_MAINNET_USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** Intercepta only knows mainnets: payments run on Base Sepolia, screening uses Base mainnet. */
export const SCREENING_CHAIN_ID = "8453";

export function isCanonicalUsdc(asset: string): boolean {
  return asset.toLowerCase() === BASE_SEPOLIA_USDC.toLowerCase();
}

export function screeningTokenAddress(asset: Address): Address {
  return isCanonicalUsdc(asset) ? BASE_MAINNET_USDC : asset;
}

export function toScreeningTypedData(typedData: TypedDataPayload): TypedDataPayload {
  const verifyingContract = typedData.domain.verifyingContract as Address | undefined;
  const message = Object.fromEntries(
    Object.entries(typedData.message).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])
  );
  return {
    ...typedData,
    domain: {
      ...typedData.domain,
      chainId: Number(SCREENING_CHAIN_ID),
      ...(verifyingContract ? { verifyingContract: screeningTokenAddress(verifyingContract) } : {})
    },
    message
  };
}
