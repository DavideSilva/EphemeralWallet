import { getAddress, type Hex } from "viem";
import type { Address } from "@eaw/risk";

export type WalletRef = { wallet: Address; permissionId: bigint };
export type AgentConfig = {
  rpcUrl: string;
  agentKey: Hex;
  interceptaKey: string | undefined;
  port: number;
  serviceUrl: string;
  /** Mount Fuji weather service (apps/weather): the second x402 seller the daemon may pay. */
  weatherUrl: string;
  uiOrigin: string;
  wallets: { default: WalletRef; risky?: WalletRef };
};

try { process.loadEnvFile(new URL("../../../../.env", import.meta.url).pathname); } catch {}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing in .env`);
  return value;
}

function address(name: string, value: string): Address {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`${name} is not an address: ${value}`);
  }
}

export function loadAgentConfig(): AgentConfig {
  return {
    rpcUrl: process.env.RPC_URL ?? "https://sepolia.base.org",
    agentKey: required("AGENT_PRIVATE_KEY") as Hex,
    // Optional: without it every screening fails closed (payments refused), it never passes as clean.
    interceptaKey: process.env.INTERCEPTA_API_KEY || undefined,
    port: Number(process.env.AGENT_PORT ?? 4100),
    serviceUrl: process.env.SERVICE_URL ?? "http://localhost:4021",
    weatherUrl: process.env.WEATHER_URL ?? `http://localhost:${process.env.WEATHER_PORT ?? 4022}`,
    uiOrigin: process.env.AGENT_UI_ORIGIN ?? "http://localhost:5173",
    wallets: {
      default: { wallet: address("WALLET_ADDRESS", required("WALLET_ADDRESS")), permissionId: BigInt(process.env.PERMISSION_ID ?? 0) },
      risky: process.env.RISKY_WALLET_ADDRESS
        ? {
            wallet: address("RISKY_WALLET_ADDRESS", process.env.RISKY_WALLET_ADDRESS),
            permissionId: BigInt(process.env.RISKY_PERMISSION_ID ?? 0)
          }
        : undefined
    }
  };
}
