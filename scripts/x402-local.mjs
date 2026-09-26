import { spawn, spawnSync } from "node:child_process";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Runs the x402 + Intercepta demo on a local Anvil fork of Base Sepolia:
// real USDC (FiatToken v2.2) and chain id 84532, fresh throwaway owner / agent /
// facilitator / payee keys funded on the fork. Screening stays live.
//   npm run x402:local            start chain, service, agent daemon and UI
//   npm run x402:local -- --demo  also run the scripted four-scenario demo

const rpc = "http://127.0.0.1:8545";
const forkUrl = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
// Anvil dev account #0 only deploys the factory. It is never screened: Intercepta
// rejects the well-known dev addresses ("Externally Owned Account ... doesn't exist"),
// so every screened identity gets a fresh key per run.
const deployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const freshAccount = () => {
  const key = generatePrivateKey();
  return { key, address: privateKeyToAccount(key).address };
};
const accounts = { owner: freshAccount(), agent: freshAccount(), facilitator: freshAccount(), payee: freshAccount() };
// Publicly OFAC-sanctioned Ronin exploiter; used when the Discord test addresses aren't in .env.
const fallbackRisky = "0x098B716B8Aaf21512996dC57EB0615e2383E2f96";

try { process.loadEnvFile(".env"); } catch {}

function commandExists(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

async function rpcCall(method, params = []) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function rpcIsRunning() {
  try {
    await rpcCall("eth_chainId");
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check, what) {
  for (let i = 0; i < 80; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${what} did not start`);
}

if (!commandExists("anvil") || !commandExists("forge")) {
  console.error("Foundry is required. Install it from https://getfoundry.sh and rerun npm run x402:local.");
  process.exit(1);
}
if (!process.env.INTERCEPTA_API_KEY) {
  console.error("INTERCEPTA_API_KEY missing in .env (free key: https://intercepta.io/ethglobal).");
  process.exit(1);
}
if (await rpcIsRunning()) {
  console.error("Port 8545 already has an RPC server running. Stop it, then run npm run x402:local again.");
  process.exit(1);
}

const riskyPayTo = process.env.RISKY_PAYTO || fallbackRisky;
const riskyOwner = process.env.RISKY_OWNER || fallbackRisky;
if (!process.env.RISKY_PAYTO || !process.env.RISKY_OWNER) {
  console.log(`RISKY_PAYTO / RISKY_OWNER not set in .env; using the public OFAC-listed ${fallbackRisky}.`);
}

const children = [];
const stop = () => { for (const child of children) child.kill(); };
process.on("SIGINT", () => { stop(); process.exit(0); });
process.on("SIGTERM", () => { stop(); process.exit(0); });

function start(label, command, args, env) {
  const child = spawn(command, args, { stdio: "inherit", env });
  child.on("exit", code => { if (code) console.error(`${label} exited with code ${code}`); });
  children.push(child);
  return child;
}

try {
  console.log(`Forking Base Sepolia (${forkUrl}) into a local Anvil chain...`);
  start("anvil", "anvil", ["--fork-url", forkUrl, "--silent"], process.env);
  await waitFor(rpcIsRunning, "Anvil");
  if ((await rpcCall("eth_chainId")) !== "0x14a34") throw new Error("fork is not Base Sepolia (chain id 84532)");

  const contractsDir = "packages/contracts";
  const deps = spawnSync("forge", ["install", "foundry-rs/forge-std", "--no-git"], { cwd: contractsDir, encoding: "utf8" });
  if (deps.status !== 0 && !deps.stderr.includes("already exists")) {
    console.error(deps.stdout, deps.stderr);
    throw new Error("Could not install forge-std");
  }

  console.log("Deploying ReusableWalletFactory...");
  const deploy = spawnSync("forge", [
    "script", "script/DeployX402.s.sol:DeployX402",
    "--rpc-url", rpc, "--broadcast", "--unlocked", "--sender", deployer
  ],{ cwd: contractsDir, encoding: "utf8", env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: "1" } });
  const factory = (deploy.stdout + deploy.stderr).match(/ReusableWalletFactory\s+(0x[a-fA-F0-9]{40})/)?.[1];
  if (deploy.status !== 0 || !factory) {
    console.error(deploy.stdout, deploy.stderr);
    throw new Error("Could not deploy ReusableWalletFactory");
  }

  // Gas for the three transacting keys; 10 USDC for the owner (setup moves 1.1 USDC into the demo wallets).
  for (const role of ["owner", "agent", "facilitator"]) {
    await rpcCall("anvil_setBalance", [accounts[role].address, "0x56BC75E2D63100000"]); // 100 ETH
  }
  await rpcCall("anvil_dealERC20", [accounts.owner.address, usdc, "0x989680"]);

  const env = {
    ...process.env,
    RPC_URL: rpc,
    OWNER_PRIVATE_KEY: accounts.owner.key,
    AGENT_PRIVATE_KEY: accounts.agent.key,
    FACILITATOR_PRIVATE_KEY: accounts.facilitator.key,
    FACTORY_ADDRESS: factory,
    CLEAN_PAYTO: accounts.payee.address,
    RISKY_PAYTO: riskyPayTo,
    RISKY_OWNER: riskyOwner
  };

  console.log("Creating and funding the demo permission wallets...");
  const setup = spawnSync("npm", ["--workspace", "@eaw/agent", "run", "x402:setup"], { encoding: "utf8", env });
  const wallet = setup.stdout.match(/WALLET_ADDRESS=(0x[a-fA-F0-9]{40})/)?.[1];
  const riskyWallet = setup.stdout.match(/RISKY_WALLET_ADDRESS=(0x[a-fA-F0-9]{40})/)?.[1];
  if (setup.status !== 0 || !wallet || !riskyWallet) {
    console.error(setup.stdout, setup.stderr);
    throw new Error("x402 setup failed");
  }
  env.WALLET_ADDRESS = wallet;
  env.PERMISSION_ID = "0";
  env.RISKY_WALLET_ADDRESS = riskyWallet;

  const servicePort = env.SERVICE_PORT ?? "4021";
  start("service", "npm", ["--workspace", "@eaw/service", "run", "start"], env);
  start("agent daemon", "npm", ["--workspace", "@eaw/agent", "run", "daemon"], env);
  await waitFor(async () => {
    try { return (await fetch(`http://localhost:${servicePort}/decisions`)).ok; } catch { return false; }
  }, "x402 service");

  console.log("\nLocal x402 demo ready (Anvil fork of Base Sepolia, chain 84532)");
  console.log("Factory:       ", factory);
  console.log("Agent wallet:  ", wallet);
  console.log("Risky wallet:  ", riskyWallet, `(owner ${riskyOwner})`);
  console.log("Clean payee:   ", accounts.payee.address);
  console.log("Risky payee:   ", riskyPayTo);
  console.log("UI:             http://localhost:5173 (x402 payments tab)\n");

  if (process.argv.includes("--demo")) {
    spawnSync("npm", ["--workspace", "@eaw/agent", "run", "x402:demo"], { stdio: "inherit", env });
  }

  start("web", "npm", ["run", "web"], env).on("exit", () => { stop(); process.exit(0); });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop();
  process.exit(1);
}
