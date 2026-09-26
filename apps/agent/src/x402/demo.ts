import { createInterceptaClient, createProfiler } from "@eaw/risk";
import { loadAgentConfig } from "./config";
import { payUrl } from "./pay";
import { createStore, type Decision } from "./store";

const config = loadAgentConfig();
const client = createInterceptaClient({ apiKey: config.interceptaKey });
const ctx = { config, client, profiler: createProfiler(client), store: createStore() };

function show(label: string, d: Decision) {
  console.log(`\n${label}\n  verdict: ${d.verdict?.kind ?? "-"}  status: ${d.status}`);
  for (const r of d.verdict?.reasons ?? []) console.log(`  - [${r.source}] ${r.code}: ${r.detail}`);
  if (d.error) console.log(`  error: ${d.error}`);
  if (d.settleTx) console.log(`  settled: https://sepolia.basescan.org/tx/${d.settleTx}`);
}

show("1) clean payee", await payUrl(ctx, `${config.serviceUrl}/dataset`, "default"));
show("2) risky payee", await payUrl(ctx, `${config.serviceUrl}/premium-dataset`, "default"));
const held = await payUrl(ctx, `${config.serviceUrl}/bulk-dataset`, "default");
show("3) above threshold", held);
if (held.status === "held" && held.payTo && held.amount) {
  show("3b) owner approves", await payUrl(ctx, `${config.serviceUrl}/bulk-dataset`, "default", { payTo: held.payTo, amount: BigInt(held.amount) }));
}
if (config.wallets.risky) show("4) risky payer", await payUrl(ctx, `${config.serviceUrl}/dataset`, "risky"));
