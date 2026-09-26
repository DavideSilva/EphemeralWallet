import { encodeAbiParameters, getAddress, isHex, size, zeroHash, type Hex } from "viem";
import { decide, type Address, type PermissionState, type PolicyConfig, type ScreeningResult, type TypedDataPayload, type Verdict } from "@eaw/risk";
import type { Screener } from "./screen";

export type Authorization = { from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex };
export type Approval = { payTo: Address; amount: bigint };

export class PaymentBlocked extends Error {
  constructor(readonly verdict: Verdict) {
    super(`${verdict.kind}: ${verdict.reasons.map(r => r.detail).join("; ")}`);
    this.name = "PaymentBlocked";
  }
}

export type GuardDeps = {
  wallet: Address;
  permissionId: bigint;
  config: PolicyConfig;
  screen: Screener;
  readPermission: () => Promise<PermissionState>;
  approve: (auth: Authorization) => Promise<Hex>;
  paidBefore: (payTo: Address) => boolean;
  approvedFor?: Approval;
  onVerdict: (event: { verdict: Verdict; auth: Authorization; screening: ScreeningResult; approveTx?: Hex }) => void;
  now?: () => bigint;
};

/** Longest authorization window the agent will approve on-chain (15 minutes). */
export const MAX_VALIDITY_SECONDS = 900n;

/** 96 bytes: longer than an ECDSA signature so x402 facilitators take the ERC-1271 path. */
export function encodeWalletSignature(permissionId: bigint, nonce: Hex): Hex {
  return encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }], [permissionId, nonce, zeroHash]);
}

function parseAuthorization(typedData: TypedDataPayload): Authorization {
  const m = typedData.message as Record<string, unknown>;
  if (!isHex(m.nonce) || size(m.nonce) !== 32) throw new Error("authorization nonce must be 32 bytes");
  return {
    from: getAddress(String(m.from)),
    to: getAddress(String(m.to)),
    value: BigInt(m.value as bigint | string),
    validAfter: BigInt(m.validAfter as bigint | string),
    validBefore: BigInt(m.validBefore as bigint | string),
    nonce: m.nonce as Hex
  };
}

/**
 * x402 ClientEvmSigner for a ReusablePermissionWallet. "Signing" is the moment of decision:
 * screen with Intercepta, decide, and only on PAY/CAP approve the exact authorization on-chain.
 */
export function createGuardedSigner(deps: GuardDeps) {
  const now = deps.now ?? (() => BigInt(Math.floor(Date.now() / 1000)));
  return {
    address: deps.wallet,
    async signTypedData(typedData: TypedDataPayload): Promise<Hex> {
      if (typedData.primaryType !== "TransferWithAuthorization") {
        throw new Error(`unsupported typed data: ${typedData.primaryType}`);
      }
      const auth = parseAuthorization(typedData);
      if (auth.from !== getAddress(deps.wallet)) throw new Error("authorization is not from this wallet");
      // approvePayment consumes budget up front, and USDC only settles while validAfter < now < validBefore:
      // an expired or inverted window would burn budget for a transfer that can never happen.
      const at = now();
      if (auth.validBefore <= at) throw new Error("authorization already expired");
      if (auth.validAfter > at) throw new Error("authorization not yet valid");
      // An approved-but-unsettled authorization outlives a revoke until validBefore: keep that window short.
      if (auth.validBefore - at > MAX_VALIDITY_SECONDS) throw new Error("authorization validity too long");

      const [screening, permission] = await Promise.all([deps.screen(typedData), deps.readPermission()]);
      const humanApproved =
        deps.approvedFor !== undefined &&
        getAddress(deps.approvedFor.payTo) === auth.to &&
        deps.approvedFor.amount === auth.value;
      const verdict = decide({
        amount: auth.value,
        screening,
        permission,
        now: now(),
        paidBefore: deps.paidBefore(auth.to),
        humanApproved,
        config: deps.config
      });

      if (verdict.kind === "REFUSE" || verdict.kind === "HOLD") {
        deps.onVerdict({ verdict, auth, screening });
        throw new PaymentBlocked(verdict);
      }
      const approveTx = await deps.approve(auth);
      deps.onVerdict({ verdict, auth, screening, approveTx });
      return encodeWalletSignature(deps.permissionId, auth.nonce);
    }
  };
}
