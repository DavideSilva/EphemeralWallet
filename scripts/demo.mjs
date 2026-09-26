import { spawn, spawnSync } from "node:child_process";

const rpc = "http://127.0.0.1:8545";
const sender = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

function commandExists(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

if (!commandExists("anvil") || !commandExists("forge")) {
  console.error("Foundry is required. Install it from https://getfoundry.sh and rerun npm run demo.");
  process.exit(1);
}

console.log("Starting local Anvil chain...");
const anvil = spawn("anvil", ["--silent"], { stdio: "inherit" });

async function waitForRpc() {
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] })
      });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Anvil did not start");
}

try {
  await waitForRpc();

  const contractsDir = "packages/contracts";
  const deps = spawnSync("forge", ["install", "foundry-rs/forge-std", "--no-git"], {
    cwd: contractsDir,
    encoding: "utf8"
  });
  if (deps.status !== 0 && !deps.stderr.includes("already exists")) {
    console.error(deps.stdout);
    console.error(deps.stderr);
    throw new Error("Could not install forge-std");
  }

  console.log("Deploying demo contracts...");
  const deploy = spawnSync("forge", [
    "script", "packages/contracts/script/Deploy.s.sol:Deploy",
    "--root", "packages/contracts",
    "--rpc-url", rpc,
    "--broadcast",
    "--unlocked",
    "--sender", sender
  ], { encoding: "utf8" });

  if (deploy.status !== 0) {
    console.error(deploy.stdout);
    console.error(deploy.stderr);
    process.exitCode = 1;
    anvil.kill();
  } else {
    const output = deploy.stdout + deploy.stderr;
    const factory = output.match(/MissionFactory\s+(0x[a-fA-F0-9]{40})/)?.[1];
    const shop = output.match(/DemoShop\s+(0x[a-fA-F0-9]{40})/)?.[1];

    if (!factory || !shop) throw new Error("Could not read deployed contract addresses");

    console.log("\nLocal demo ready");
    console.log("MissionFactory:", factory);
    console.log("DemoShop:", shop);
    console.log("UI: http://localhost:5173\n");

    const web = spawn("npm", ["run", "web"], {
      stdio: "inherit",
      env: { ...process.env, VITE_FACTORY: factory, VITE_DEMO_SHOP: shop }
    });

    const stop = () => { web.kill(); anvil.kill(); };
    process.on("SIGINT", () => { stop(); process.exit(0); });
    process.on("SIGTERM", () => { stop(); process.exit(0); });
    web.on("exit", () => { anvil.kill(); });
  }
} catch (error) {
  console.error(error);
  anvil.kill();
  process.exit(1);
}
