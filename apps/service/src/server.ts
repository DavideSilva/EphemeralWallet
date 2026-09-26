import { x402Facilitator } from "@x402/core/facilitator";
import type { RouteConfig } from "@x402/core/server";
import type { Network, PaymentPayload, PaymentRequirements, SupportedResponse } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { ExactEvmScheme as ExactEvmServerScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import express from "express";
import { createWalletClient, http, isAddress, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createInterceptaClient, createProfiler } from "@eaw/risk";
import { loadServiceConfig } from "./config";
import { createIdentityReader, createPayerGate, type PayerLogEntry } from "./payer-gate";

const NETWORK: Network = "eip155:84532";
const config = loadServiceConfig();
const profiler = createProfiler(createInterceptaClient({ apiKey: config.interceptaKey }));
const payerLog: PayerLogEntry[] = [];

const account = privateKeyToAccount(config.facilitatorKey);
const viemClient = createWalletClient({ account, chain: baseSepolia, transport: http(config.rpcUrl) }).extend(publicActions);
const facilitator = new x402Facilitator();
registerExactEvmScheme(facilitator, {
  signer: toFacilitatorEvmSigner({
    address: account.address,
    getCode: viemClient.getCode,
    readContract: viemClient.readContract,
    // ERC-1271 aware: required for wallet payers. viem's VerifyTypedDataParameters is a much
    // richer generic type (ERC-6492 factory data, block tag/number/hash discriminants) that TS
    // cannot reconcile against @x402/evm's plain 6-field signer shape by structural assignment
    // alone; the cast narrows only the argument type checker sees, the call still runs viem's
    // real (ERC-1271-capable) verifyTypedData with these exact args.
    verifyTypedData: args => viemClient.verifyTypedData(args as Parameters<typeof viemClient.verifyTypedData>[0]),
    writeContract: viemClient.writeContract,
    sendTransaction: viemClient.sendTransaction,
    waitForTransactionReceipt: viemClient.waitForTransactionReceipt
  }),
  networks: NETWORK
});

const resourceServer = new x402ResourceServer({
  verify: facilitator.verify.bind(facilitator),
  settle: facilitator.settle.bind(facilitator),
  // x402Facilitator#getSupported() types `network` as plain `string`; the runtime value is always
  // a valid CAIP-2 network id, so this cast just restores the narrower FacilitatorClient contract.
  getSupported: async () => facilitator.getSupported() as unknown as SupportedResponse
})
  .register(NETWORK, new ExactEvmServerScheme())
  .onBeforeVerify(
    createPayerGate({
      profiler,
      readIdentities: createIdentityReader(config.rpcUrl),
      // Runs before screening so an unsigned or invalid payload never costs an Intercepta call.
      preVerify: ({ paymentPayload, requirements }) =>
        facilitator.verify(paymentPayload as PaymentPayload, requirements as PaymentRequirements),
      log: payerLog
    })
  );

const route = (price: string, payTo: string, description: string): RouteConfig => ({
  accepts: [{ scheme: "exact", price, network: NETWORK, payTo }],
  description,
  mimeType: "application/json"
});

const app = express();
app.use((_req, res, next) => {
  // Not "*": /risk spends Intercepta quota and /decisions exposes the payer log.
  res.setHeader("access-control-allow-origin", config.uiOrigin);
  res.setHeader("vary", "origin");
  res.setHeader("access-control-expose-headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  next();
});
app.get("/risk/:address", async (req, res) => {
  const address = req.params.address;
  // Express decodes %2F in params: without this check a crafted value could reach other Intercepta paths with our key.
  if (!isAddress(address, { strict: false })) {
    res.status(400).json({ error: "invalid address" });
    return;
  }
  try {
    res.json(await profiler.getProfile(address));
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
app.get("/decisions", (_req, res) => res.json(payerLog));
app.use(
  paymentMiddleware(
    {
      "GET /dataset": route("$0.01", config.cleanPayTo, "Market dataset (clean payee)"),
      "GET /premium-dataset": route("$0.01", config.riskyPayTo, "Premium dataset (payee with known risk)"),
      "GET /bulk-dataset": route("$0.30", config.cleanPayTo, "Bulk dataset (above auto-approval threshold)")
    },
    resourceServer
  )
);
const data = (name: string) => (_req: express.Request, res: express.Response) => res.json({ dataset: name, rows: [[1, 2, 3]] });
app.get("/dataset", data("dataset"));
app.get("/premium-dataset", data("premium-dataset"));
app.get("/bulk-dataset", data("bulk-dataset"));

app.listen(config.port, () => console.log(`x402 service on http://localhost:${config.port}`));
