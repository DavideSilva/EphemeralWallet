import {
  isCanonicalUsdc,
  screeningTokenAddress,
  SCREENING_CHAIN_ID,
  toScreeningTypedData,
  type Address,
  type InterceptaClient,
  type Profiler,
  type ScreeningResult,
  type TypedDataPayload
} from "@eaw/risk";

export type Screener = (typedData: TypedDataPayload) => Promise<ScreeningResult>;

/**
 * Payer-side gate: screens the destination (payTo), the token and the exact
 * EIP-3009 authorization with live Intercepta calls, in parallel.
 */
export function createScreener(deps: { client: InterceptaClient; profiler: Profiler }): Screener {
  return async typedData => {
    const message = typedData.message as { from: Address; to: Address };
    const asset = typedData.domain.verifyingContract as Address;
    const [payee, token, authorization] = await Promise.allSettled([
      deps.profiler.getProfile(message.to, "payee"),
      deps.client.scanToken(screeningTokenAddress(asset), SCREENING_CHAIN_ID),
      deps.client.scanMessage({ from: message.from, chainId: SCREENING_CHAIN_ID, typedData: toScreeningTypedData(typedData) })
    ]);
    const unavailable = [payee, token, authorization]
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map(r => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
    return {
      payee: payee.status === "fulfilled" ? payee.value : undefined,
      token: token.status === "fulfilled" ? token.value : undefined,
      message: authorization.status === "fulfilled" ? authorization.value : undefined,
      tokenIsCanonical: isCanonicalUsdc(asset),
      unavailable
    };
  };
}
