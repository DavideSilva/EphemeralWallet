import type { Hex } from "viem";

try { process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname); } catch {}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing in .env`);
  return value;
}

export function loadServiceConfig() {
  return {
    rpcUrl: process.env.RPC_URL ?? "https://sepolia.base.org",
    port: Number(process.env.SERVICE_PORT ?? 4021),
    // The only browser origin allowed to call the service's JSON endpoints (the Payments page).
    uiOrigin: process.env.SERVICE_UI_ORIGIN ?? process.env.AGENT_UI_ORIGIN ?? "http://localhost:5173",
    facilitatorKey: required("FACILITATOR_PRIVATE_KEY") as Hex,
    interceptaKey: required("INTERCEPTA_API_KEY"),
    cleanPayTo: required("CLEAN_PAYTO") as Hex,
    riskyPayTo: required("RISKY_PAYTO") as Hex
  };
}
