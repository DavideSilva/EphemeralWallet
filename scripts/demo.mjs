import { spawn, spawnSync } from "node:child_process";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Runs the whole demo (cards + x402 + Intercepta) on a local Anvil fork of Base Sepolia:
// real USDC (FiatToken v2.2) and chain id 84532, fresh throwaway owner / agent /
// facilitator / payee keys funded on the fork. Two x402 sellers: the dataset service
// and the Mount Fuji weather service, each settling with its own facilitator key. Screening stays live; without an
// INTERCEPTA_API_KEY it fails closed (payments refused, merchants unverified).
//   npm run demo                   start chain, service, agent daemon and UI
//   npm run demo -- --scenarios    also run the scripted four-scenario x402 demo

// Load .env before reading any config from it. A missing file is fine; anything else
// (such as Node < 20.12 without process.loadEnvFile) must not silently drop the key.
try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const rpc = "http://127.0.0.1:8545";
const forkUrl = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
// Anvil dev account #0 deploys the factory and is the UI's card owner. It is never screened: Intercepta
// rejects the well-known dev addresses ("Externally Owned Account ... doesn't exist"),
// so every screened identity gets a fresh key per run.
const deployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const freshAccount = () => {
  const key = generatePrivateKey();
  return { key, address: privateKeyToAccount(key).address };
};
const accounts = {
  owner: freshAccount(),
  agent: freshAccount(),
  facilitator: freshAccount(),
  payee: freshAccount(),
  // Separate facilitator key: two processes sending from one key would race on nonces.
  weatherFacilitator: freshAccount(),
  weatherPayee: freshAccount()
};
// Defaults when .env doesn't set them. Both tier BLOCKED with Intercepta, for different reasons:
// the payee is a test address from Intercepta (known scammer, funds from exploits and drainers),
// the owner is the publicly OFAC-listed Ronin bridge exploiter (sanctions).
const fallbackRiskyPayTo = "0x39308ae43e5dda98db5fb17d005c5c764e5a2fed";
const fallbackRiskyOwner = "0x098B716B8Aaf21512996dC57EB0615e2383E2f96";

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
  console.error("Foundry is required. Install it from https://getfoundry.sh and rerun npm run demo.");
  process.exit(1);
}
if (!process.env.INTERCEPTA_API_KEY) {
  console.warn(
    "\nINTERCEPTA_API_KEY is not set in .env (free key: https://intercepta.io/ethglobal).\n" +
      "Starting anyway, but screening fails closed: every x402 payment is refused and merchants show as unverified.\n"
  );
}
if (await rpcIsRunning()) {
  console.error("Port 8545 already has an RPC server running. Stop it, then run npm run demo again.");
  process.exit(1);
}

const riskyPayTo = process.env.RISKY_PAYTO || fallbackRiskyPayTo;
const riskyOwner = process.env.RISKY_OWNER || fallbackRiskyOwner;
if (!process.env.RISKY_PAYTO) console.log(`RISKY_PAYTO not set in .env; using Intercepta's scam-flagged test address ${fallbackRiskyPayTo}.`);
if (!process.env.RISKY_OWNER) console.log(`RISKY_OWNER not set in .env; using the OFAC-listed Ronin exploiter ${fallbackRiskyOwner}.`);

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
  // --hardfork osaka: a fork doesn't get Base's P-256 precompile (0x100) by default; the passkey approval plugin needs it.
  start("anvil", "anvil", ["--fork-url", forkUrl, "--hardfork", "osaka", "--silent"], process.env);
  await waitFor(rpcIsRunning, "Anvil");
  if ((await rpcCall("eth_chainId")) !== "0x14a34") throw new Error("fork is not Base Sepolia (chain id 84532)");
  // The web app reads events and blocks from here on: earlier blocks live on the public RPC.
  const fromBlock = BigInt(await rpcCall("eth_blockNumber")) + 1n;

  const contractsDir = "packages/contracts";
  for (const dep of ["foundry-rs/forge-std", "vectorized/solady@v0.1.26"]) {
    const deps = spawnSync("forge", ["install", dep, "--no-git"], { cwd: contractsDir, encoding: "utf8" });
    if (deps.status !== 0 && !deps.stderr.includes("already exists")) {
      console.error(deps.stdout, deps.stderr);
      throw new Error(`Could not install ${dep}`);
    }
  }

  // The full card deployment: its ReusableWalletFactory also creates the x402 wallets.
  console.log("Deploying the card and x402 contracts...");
  const deploy = spawnSync("forge", [
    "script", "script/Deploy.s.sol:Deploy",
    "--rpc-url", rpc, "--broadcast", "--unlocked", "--sender", deployer
  ],{ cwd: contractsDir, encoding: "utf8", env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: "1" } });
  const deployed = name => (deploy.stdout + deploy.stderr).match(new RegExp(`${name}\\s+(0x[a-fA-F0-9]{40})`))?.[1];
  const factory = deployed("ReusableWalletFactory");
  const missionFactory = deployed("MissionFactory");
  const approvalHook = deployed("ApprovalHook");
  const merchants = ["Cafe", "TicketOffice", "TipJar"].map(deployed);
  if (deploy.status !== 0 || !factory || !missionFactory || !approvalHook || merchants.some(m => !m)) {
    console.error(deploy.stdout, deploy.stderr);
    throw new Error("Could not deploy the demo contracts");
  }

  // Gas for the four transacting keys; 10 USDC for the owner (setup moves 1.1 USDC into the demo wallets).
  for (const role of ["owner", "agent", "facilitator", "weatherFacilitator"]) {
    await rpcCall("anvil_setBalance", [accounts[role].address, "0x56BC75E2D63100000"]); // 100 ETH
  }
  await rpcCall("anvil_dealERC20", [accounts.owner.address, usdc, "0x989680"]);
  // The UI signs as the deployer: 10 USDC funds the budgets of cards for the weather service (an x402 merchant).
  await rpcCall("anvil_dealERC20", [deployer, usdc, "0x989680"]);

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
  const weatherPort = env.WEATHER_PORT ?? "4022";
  start("service", "npm", ["--workspace", "@eaw/service", "run", "start"], env);
  start("weather", "npm", ["--workspace", "@eaw/weather", "run", "start"], {
    ...env,
    WEATHER_PAY_TO: accounts.weatherPayee.address,
    WEATHER_FACILITATOR_PRIVATE_KEY: accounts.weatherFacilitator.key
  });
  start("agent daemon", "npm", ["--workspace", "@eaw/agent", "run", "daemon"], env);
  await waitFor(async () => {
    try { return (await fetch(`http://localhost:${servicePort}/decisions`)).ok; } catch { return false; }
  }, "x402 service");
  await waitFor(async () => {
    try { return (await fetch(`http://localhost:${weatherPort}/weather/mount-fuji`)).status === 402; } catch { return false; }
  }, "weather service");

  console.log("\nLocal demo ready (Anvil fork of Base Sepolia, chain 84532)");
  console.log("Factory:       ", factory);
  console.log("Agent wallet:  ", wallet);
  console.log("Risky wallet:  ", riskyWallet, `(owner ${riskyOwner})`);
  console.log("Clean payee:   ", accounts.payee.address);
  console.log("Risky payee:   ", riskyPayTo);
  console.log("Weather payee: ", accounts.weatherPayee.address, `(http://localhost:${weatherPort}/weather/mount-fuji)`);
  console.log("UI:             http://localhost:5173 (cards), http://localhost:5173/payments (x402)\n");

  if (process.argv.includes("--scenarios")) {
    spawnSync("npm", ["--workspace", "@eaw/agent", "run", "x402:demo"], { stdio: "inherit", env });
  }

  const webEnv = {
    ...env,
    VITE_CHAIN_ID: "84532",
    VITE_FROM_BLOCK: fromBlock.toString(),
    VITE_FACTORY: missionFactory,
    VITE_REUSABLE_FACTORY: factory,
    VITE_APPROVAL_HOOK: approvalHook,
    VITE_MERCHANTS: merchants.join(","),
    VITE_WEATHER_PAY_TO: accounts.weatherPayee.address
  };
  start("web", "npm", ["run", "web"], webEnv).on("exit", () => { stop(); process.exit(0); });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop();
  process.exit(1);
}
