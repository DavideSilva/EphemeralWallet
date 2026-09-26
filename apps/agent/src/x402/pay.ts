import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { DEFAULT_POLICY, type InterceptaClient, type Profiler, type Verdict } from "@eaw/risk";
import type { Hex } from "viem";
import type { AgentConfig } from "./config";
import { createGuardedSigner, PaymentBlocked, type Approval, type Authorization } from "./guarded-signer";
import { createScreener } from "./screen";
import type { createStore, Decision } from "./store";
import { createWalletGateway } from "./wallet";

export type PayContext = { config: AgentConfig; client: InterceptaClient; profiler: Profiler; store: ReturnType<typeof createStore> };
const NETWORK = "eip155:84532";

export async function payUrl(ctx: PayContext, url: string, walletKey: "default" | "risky", approvedFor?: Approval): Promise<Decision> {
  const ref = ctx.config.wallets[walletKey];
  if (!ref) throw new Error(`wallet "${walletKey}" not configured`);
  const base = { url, wallet: ref.wallet, permissionId: ref.permissionId.toString() };
  const gateway = createWalletGateway(ctx.config.rpcUrl, ctx.config.agentKey, ref);

  let seen: { verdict: Verdict; auth: Authorization; approveTx?: Hex; payee?: Decision["payee"] } | undefined;
  const signer = createGuardedSigner({
    wallet: ref.wallet,
    permissionId: ref.permissionId,
    config: DEFAULT_POLICY,
    screen: createScreener({ client: ctx.client, profiler: ctx.profiler }),
    readPermission: gateway.readPermission,
    approve: gateway.approve,
    paidBefore: ctx.store.paidBefore,
    approvedFor,
    onVerdict: e => { seen = { verdict: e.verdict, auth: e.auth, approveTx: e.approveTx, payee: e.screening.payee }; }
  });
  const detail = () =>
    seen && {
      payTo: seen.auth.to,
      amount: seen.auth.value.toString(),
      verdict: { kind: seen.verdict.kind, reasons: seen.verdict.reasons, cap: seen.verdict.cap?.toString() },
      payee: seen.payee,
      approveTx: seen.approveTx
    };

  const first = await fetch(url);
  if (first.status !== 402) return ctx.store.addDecision({ ...base, status: "failed", error: `expected 402, got ${first.status}` });
  const header = first.headers.get("PAYMENT-REQUIRED");
  if (!header) return ctx.store.addDecision({ ...base, status: "failed", error: "missing PAYMENT-REQUIRED header" });
  const paymentRequired = decodePaymentRequiredHeader(header);

  const select = (_version: number, requirements: PaymentRequirements[]) => {
    const match = requirements.find(r => r.network === NETWORK && r.scheme === "exact");
    if (!match) throw new Error(`no exact ${NETWORK} requirement offered`);
    return match;
  };
  const client = new x402Client(select).register(NETWORK, new ExactEvmScheme(signer));

  let payload;
  try {
    payload = await client.createPaymentPayload(paymentRequired);
  } catch (error) {
    if (!(error instanceof PaymentBlocked)) {
      return ctx.store.addDecision({ ...base, ...detail(), status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
    const decision = ctx.store.addDecision({ ...base, ...detail(), status: error.verdict.kind === "HOLD" ? "held" : "refused" });
    if (error.verdict.kind === "HOLD" && seen) {
      const hold = ctx.store.addHold({
        decisionId: decision.id, url, walletKey, payTo: seen.auth.to, amount: seen.auth.value.toString(), reasons: error.verdict.reasons
      });
      decision.holdId = hold.id;
    }
    return decision;
  }

  const paid = await fetch(url, { headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) } });
  if (paid.status === 200) {
    const settlement = paid.headers.get("PAYMENT-RESPONSE");
    const settleTx = settlement ? decodePaymentResponseHeader(settlement).transaction : undefined;
    return ctx.store.addDecision({ ...base, ...detail(), status: "settled", settleTx });
  }
  const rejection = paid.headers.get("PAYMENT-REQUIRED");
  const reason = rejection ? decodePaymentRequiredHeader(rejection).error : `HTTP ${paid.status}`;
  return ctx.store.addDecision({ ...base, ...detail(), status: "rejected_by_payee", error: reason ?? `HTTP ${paid.status}` });
}
