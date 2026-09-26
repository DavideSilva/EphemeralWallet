import express from "express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No .env file: rely on the shell environment.
}

const payTo = process.env.WEATHER_PAY_TO;
if (!payTo || !/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
  console.error("WEATHER_PAY_TO is not set. Set it to the address that should receive payments.");
  process.exit(1);
}
const port = Number(process.env.WEATHER_PORT ?? 4021);
const price = process.env.WEATHER_PRICE ?? "$0.01";
// Base Sepolia by default, paid in testnet USDC and settled by the public x402 facilitator.
const network = (process.env.WEATHER_NETWORK ?? "eip155:84532") as `${string}:${string}`;
const facilitatorUrl = process.env.WEATHER_FACILITATOR_URL ?? "https://x402.org/facilitator";

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })).register(
  network,
  new ExactEvmScheme(),
);

const app = express();

app.use(
  paymentMiddleware(
    {
      "GET /weather/mount-fuji": {
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

app.listen(port, () => {
  console.log(`Mount Fuji weather on http://localhost:${port}/weather/mount-fuji (${price} on ${network} to ${payTo})`);
});

// Mock data, seeded by the hour so repeated requests agree.
function mountFujiReport(now = new Date()) {
  const hour = Math.floor(now.getTime() / 3_600_000);
  let state = hour >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];

  const conditions = pick(["Clear", "Partly cloudy", "Cloudy", "Light snow", "Fog", "Strong winds"]);
  const temperatureC = Math.round(-12 + random() * 16);
  const windKph = Math.round(15 + random() * 60);

  return {
    mock: true,
    location: "Mount Fuji summit, Japan (3,776 m)",
    issuedAt: new Date(hour * 3_600_000).toISOString(),
    conditions,
    temperatureC,
    windKph,
    windDirection: pick(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]),
    visibilityKm: conditions === "Fog" ? 0.2 : Math.round(5 + random() * 45),
    advisory: windKph > 50 || temperatureC < -5 ? "Not recommended for climbing" : "Suitable for experienced climbers",
  };
}
