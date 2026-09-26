import { isAddress, type Address } from "viem";

function address(value: string | undefined, name: string): Address {
  if (!value || !isAddress(value)) throw new Error(`${name} is not set. Start the app with npm run demo.`);
  return value;
}

export const RPC_URL = "http://127.0.0.1:8545";
// Anvil account #0 is unlocked, so the mock connector can send its transactions without a signer.
export const OWNER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const DEFAULT_AGENT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

export function contracts() {
  const merchants = (import.meta.env.VITE_MERCHANTS ?? "")
    .split(",")
    .filter(Boolean)
    .map((value: string) => address(value, "VITE_MERCHANTS"));
  return {
    missionFactory: address(import.meta.env.VITE_FACTORY, "VITE_FACTORY"),
    reusableFactory: address(import.meta.env.VITE_REUSABLE_FACTORY, "VITE_REUSABLE_FACTORY"),
    merchants,
  };
}
