import { mkdirSync, writeFileSync } from "node:fs";
import { createInterceptaClient } from "../src/intercepta";

try { process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname); } catch {}
const apiKey = process.env.INTERCEPTA_API_KEY;
if (!apiKey) throw new Error("INTERCEPTA_API_KEY missing (free key: intercepta.io/ethglobal)");
const risky = process.argv[2] ?? process.env.RISKY_PAYTO;
const clean = process.argv[3] ?? process.env.CLEAN_PAYTO;
if (!risky || !clean) throw new Error("Usage: npm --workspace @eaw/risk run smoke -- <riskyAddress> <cleanAddress>");

const client = createInterceptaClient({ apiKey });
const started = Date.now();
const out = {
  riskyQuick: await client.quickScanAddress(risky as `0x${string}`),
  riskyDeep: await client.deepScanAddress(risky as `0x${string}`),
  riskyOverview: await client.summarizeAddress(risky as `0x${string}`),
  cleanQuick: await client.quickScanAddress(clean as `0x${string}`),
  cleanDeep: await client.deepScanAddress(clean as `0x${string}`),
  usdc: await client.scanToken("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "8453"),
  // x402 authorizations are TransferWithAuthorization, which is not in Scan Message's documented messageType list.
  authorization: await client.scanMessage({
    from: clean as `0x${string}`,
    chainId: "8453",
    typedData: {
      domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" }, { name: "version", type: "string" },
          { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }
        ],
        TransferWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }
        ]
      },
      primaryType: "TransferWithAuthorization",
      message: { from: clean, to: risky, value: "10000", validAfter: "0", validBefore: "9999999999", nonce: `0x${"11".repeat(32)}` }
    }
  })
};
console.log(JSON.stringify(out, null, 2));
console.log(`live calls ok in ${Date.now() - started} ms`);
mkdirSync(new URL("../test/fixtures", import.meta.url), { recursive: true });
writeFileSync(new URL("../test/fixtures/live.json", import.meta.url), JSON.stringify(out, null, 2));
