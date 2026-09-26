import { decodePaymentRequiredHeader } from "@x402/core/http";
import { createInterceptaClient, createProfiler } from "@eaw/risk";
import type { Address } from "viem";
import type { CatalogItem, Currency, Plan } from "./planner";
import { payFromWallet } from "./x402/pay";
import { createStore } from "./x402/store";

export const USDC: Currency = { symbol: "USDC", decimals: 6 };

/** Sellers that take cards over x402 instead of a shop contract. The card's merchant is the seller's payee. */
const sellers = [
  {
    name: "Mount Fuji Weather",
    item: "Mount Fuji weather report",
    url: process.env.WEATHER_URL ?? `http://localhost:${process.env.WEATHER_PORT ?? 4022}/weather/mount-fuji`,
  },
];

export type X402Seller = { name: string; url: string; items: CatalogItem[] };

/** Asks each known seller for its price (the 402 response) and returns the one whose payee is the card's merchant. */
export async function findSeller(merchant: Address): Promise<X402Seller | undefined> {
  for (const seller of sellers) {
    try {
      const response = await fetch(seller.url, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      const header = response.status === 402 ? response.headers.get("PAYMENT-REQUIRED") : null;
      if (!header) continue;
      const offer = decodePaymentRequiredHeader(header).accepts.find(a => a.payTo.toLowerCase() === merchant.toLowerCase());
      if (offer) return { name: seller.name, url: seller.url, items: [{ name: seller.item, price: BigInt(offer.amount) }] };
    } catch {
      // Seller not running: try the next one.
    }
  }
  return undefined;
}

const usdc = (value: bigint | string) => `${Number(value) / 1e6} USDC`;

/**
 * Buys from an x402 seller with a USDC card: each payment is screened by Intercepta (payee, token, the exact
 * authorization) and decided PAY/CAP/HOLD/REFUSE before the card approves it on-chain. Returns the exit code.
 */
export async function buyOverX402(input: {
  rpcUrl: string;
  wallet: Address;
  permissionId: bigint;
  agent: Address;
  seller: X402Seller;
  plan: Plan & { action: "purchase" };
}): Promise<number> {
  // Optional: without a key every screening fails closed and the payment is refused, never passed as clean.
  const client = createInterceptaClient({ apiKey: process.env.INTERCEPTA_API_KEY || undefined });
  const ctx = { rpcUrl: input.rpcUrl, client, profiler: createProfiler(client), store: createStore() };
  // The agent address is an unlocked Anvil account: the local node signs its approvePayment calls.
  const payer = { ref: { wallet: input.wallet, permissionId: input.permissionId }, agent: input.agent };

  for (let n = 1; n <= input.plan.quantity; n++) {
    if (input.plan.quantity > 1) console.log(`Payment ${n} of ${input.plan.quantity}`);
    console.log("Screening with Intercepta...");
    const decision = await payFromWallet(ctx, input.seller.url, payer);
    if (decision.verdict) {
      console.log(`Verdict ${decision.verdict.kind}${decision.amount ? ` for ${usdc(decision.amount)}` : ""}`);
      for (const r of decision.verdict.reasons) console.log(`        [${r.source}] ${r.code}: ${r.detail}`);
    }
    if (decision.status !== "settled") {
      const outcome = {
        refused: "Refused by the agent. Nothing was paid.",
        held: "Held: this payment needs the owner's approval, so the agent didn't pay.",
        rejected_by_payee: "The seller refused the payment.",
        failed: "The payment failed. Nothing was paid.",
        unsettled: "Approved on the card but not confirmed by the seller; it may still settle until it expires.",
        settled: "",
        superseded: "",
      }[decision.status];
      console.log(outcome);
      if (decision.error) console.log(`        ${decision.error}`);
      return 2;
    }
    console.log(`Bought  ${input.seller.items[input.plan.itemId].name} from ${input.seller.name}`);
    if (decision.approveTx) console.log(`Card    ${decision.approveTx} (approvePayment)`);
    if (decision.settleTx) console.log(`Paid    ${decision.settleTx}`);
    if (decision.resource !== undefined) console.log(JSON.stringify(decision.resource, null, 2));
  }
  return 0;
}
