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

async function rpcIsRunning() {
  try {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] })
    });
    return response.ok;
  } catch {
    return false;
  }
}

if (await rpcIsRunning()) {
  console.error("Port 8545 already has an RPC server running. Stop the old Anvil process, then run npm run demo again.");
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
  // lib/ is gitignored, so the Solidity dependencies are installed on first run.
  for (const dep of ["foundry-rs/forge-std", "vectorized/solady@v0.1.26"]) {
    const deps = spawnSync("forge", ["install", dep, "--no-git"], { cwd: contractsDir, encoding: "utf8" });
    if (deps.status !== 0 && !deps.stderr.includes("already exists")) {
      console.error(deps.stdout);
      console.error(deps.stderr);
      throw new Error(`Could not install ${dep}`);
    }
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
    const reusableFactory = output.match(/ReusableWalletFactory\s+(0x[a-fA-F0-9]{40})/)?.[1];
    const approvalHook = output.match(/ApprovalHook\s+(0x[a-fA-F0-9]{40})/)?.[1];
    const cafe = output.match(/Cafe\s+(0x[a-fA-F0-9]{40})/)?.[1];
    const ticketOffice = output.match(/TicketOffice\s+(0x[a-fA-F0-9]{40})/)?.[1];
    const tipJar = output.match(/TipJar\s+(0x[a-fA-F0-9]{40})/)?.[1];

    if (!factory || !reusableFactory || !approvalHook || !cafe || !ticketOffice || !tipJar) {
      throw new Error("Could not read deployed contract addresses");
    }

    console.log("\nLocal demo ready");
    console.log("MissionFactory:", factory);
    console.log("ReusableWalletFactory:", reusableFactory);
    console.log("Merchants:", `Cafe ${cafe}`, `Ticket office ${ticketOffice}`, `Tip jar ${tipJar}`);
    console.log("UI: http://localhost:5173\n");

    const web = spawn("npm", ["run", "web"], {
      stdio: "inherit",
      env: {
        ...process.env,
        VITE_FACTORY: factory,
        VITE_REUSABLE_FACTORY: reusableFactory,
        VITE_APPROVAL_HOOK: approvalHook,
        VITE_MERCHANTS: [cafe, ticketOffice, tipJar].join(",")
      }
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
