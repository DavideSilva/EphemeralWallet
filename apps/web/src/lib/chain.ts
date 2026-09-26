import { http, createConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { mock } from "wagmi/connectors";
import { foundry } from "wagmi/chains";
import { OWNER, RPC_URL } from "./config";

export const wagmiConfig = createConfig({
  chains: [foundry],
  connectors: [mock({ accounts: [OWNER], features: { defaultConnected: true, reconnect: true } })],
  transports: { [foundry.id]: http(RPC_URL) },
  pollingInterval: 1_000,
});

export const publicClient = getPublicClient(wagmiConfig);

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
