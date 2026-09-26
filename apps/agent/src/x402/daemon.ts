import { createServer } from "node:http";
import { createInterceptaClient, createProfiler } from "@eaw/risk";
import { loadAgentConfig } from "./config";
import { createDaemonHandler } from "./daemon-handler";
import { payUrl } from "./pay";
import { createStore } from "./store";
import { createWalletGateway } from "./wallet";

const config = loadAgentConfig();
const client = createInterceptaClient({ apiKey: config.interceptaKey });
const handler = createDaemonHandler({
  config,
  client,
  profiler: createProfiler(client),
  store: createStore(),
  pay: payUrl,
  walletStatus: ref => createWalletGateway(config.rpcUrl, config.agentKey, ref).readStatus()
});

createServer(handler).listen(config.port, "127.0.0.1", () => console.log(`agent daemon on http://127.0.0.1:${config.port}`));
