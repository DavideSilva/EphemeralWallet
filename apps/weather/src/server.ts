import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import type { SupportedResponse } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/express";
import { createWalletClient, http, publicActions, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No .env file: rely on the shell environment.
}

const payTo = process.env.WEATHER_PAY_TO;
if (!payTo || !/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
  console.error("WEATHER_PAY_TO must be the 0x address that receives payments.");
  process.exit(1);
}
const port = Number(process.env.WEATHER_PORT ?? 4022);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("WEATHER_PORT must be a port number.");
  process.exit(1);
}

// $0.01 in testnet USDC on Base Sepolia.
const price = "$0.01";
const network = "eip155:84532";

/**
 * With WEATHER_FACILITATOR_PRIVATE_KEY (set by npm run demo) payments settle in-process on RPC_URL,
 * which is how the service works on the local fork; otherwise through the public x402 facilitator.
 */
function createFacilitator(): { client: FacilitatorClient; label: string } {
  const key = process.env.WEATHER_FACILITATOR_PRIVATE_KEY;
  if (!key) return { client: new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" }), label: "the public x402 facilitator" };
  const rpcUrl = process.env.RPC_URL ?? "https://sepolia.base.org";
  const viemClient = createWalletClient({ account: privateKeyToAccount(key as Hex), chain: baseSepolia, transport: http(rpcUrl) }).extend(
    publicActions,
  );
  const facilitator = new x402Facilitator();
  registerExactEvmScheme(facilitator, {
    signer: toFacilitatorEvmSigner({
      address: viemClient.account.address,
      getCode: viemClient.getCode,
      readContract: viemClient.readContract,
      // viem's verifyTypedData checks ERC-1271, which the agent's permission wallet needs (see apps/service).
      verifyTypedData: args => viemClient.verifyTypedData(args as Parameters<typeof viemClient.verifyTypedData>[0]),
      writeContract: viemClient.writeContract,
      sendTransaction: viemClient.sendTransaction,
      waitForTransactionReceipt: viemClient.waitForTransactionReceipt,
    }),
    networks: network,
  });
  return {
    client: {
      verify: facilitator.verify.bind(facilitator),
      settle: facilitator.settle.bind(facilitator),
      getSupported: async () => facilitator.getSupported() as unknown as SupportedResponse,
    },
    label: `a local facilitator on ${rpcUrl}`,
  };
}

const facilitator = createFacilitator();
const resourceServer = new x402ResourceServer(facilitator.client).register(network, new ExactEvmScheme());

const app = express();

app.use(
  paymentMiddleware(
    {
      // No method prefix, so every method pays (Express would otherwise answer HEAD for free).
      "/weather/mount-fuji": {
        accepts: { scheme: "exact", price, network, payTo },
        description: "Mount Fuji weather report (mock data)",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/weather/mount-fuji", (_req, res) => {
  res.json(mountFujiReport());
});

app
  .listen(port, () => {
    console.log(`Mount Fuji weather on http://localhost:${port}/weather/mount-fuji (${price} on ${network} to ${payTo}, settled by ${facilitator.label})`);
  })
  .on("error", error => {
    console.error(`Could not start on port ${port}: ${error.message}`);
    process.exit(1);
  });

// Mock data: a fresh random report on every paid request.
function mountFujiReport() {
  const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
  const conditions = pick(["Clear", "Partly cloudy", "Cloudy", "Light snow", "Fog", "Strong winds"]);
  const temperatureC = Math.round(-12 + Math.random() * 16);
  const windKph = Math.round(15 + Math.random() * 60);

  return {
    mock: true,
    location: "Mount Fuji summit, Japan (3,776 m)",
    issuedAt: new Date().toISOString(),
    conditions,
    temperatureC,
    windKph,
    windDirection: pick(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]),
    visibilityKm: conditions === "Fog" ? 0.2 : Math.round(5 + Math.random() * 45),
    advisory: windKph > 50 || temperatureC < -5 ? "Not recommended for climbing" : "Suitable for experienced climbers",
  };
}
