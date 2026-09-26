import express from "express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/express";

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

// $0.01 in testnet USDC on Base Sepolia, settled by the public x402 facilitator.
const price = "$0.01";
const network = "eip155:84532";
const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" })).register(
  network,
  new ExactEvmScheme(),
);

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

app.listen(port, error => {
  if (error) {
    console.error(`Could not start on port ${port}: ${error.message}`);
    process.exit(1);
  }
  console.log(`Mount Fuji weather on http://localhost:${port}/weather/mount-fuji (${price} on ${network} to ${payTo})`);
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
