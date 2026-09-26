import { http, createConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { mock } from "wagmi/connectors";
import { foundry } from "wagmi/chains";
import { CHAIN_ID, OWNER, RPC_URL } from "./config";

// Always the local Anvil node; only the chain id differs between a fresh chain and a Base Sepolia fork.
const localChain = CHAIN_ID === foundry.id ? foundry : { ...foundry, id: CHAIN_ID, name: `Local fork (${CHAIN_ID})` };

export const wagmiConfig = createConfig({
  chains: [localChain],
  connectors: [mock({ accounts: [OWNER], features: { defaultConnected: true, reconnect: true } })],
  transports: { [localChain.id]: http(RPC_URL) },
  pollingInterval: 1_000,
});

// The config has exactly one chain, so there is always a client; the chain-id union just hides that from the types.
export const publicClient = getPublicClient(wagmiConfig)!;

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
