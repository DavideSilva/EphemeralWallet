import { createPublicClient, createWalletClient, http, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { erc20Abi, reusableWalletFactoryAbi, USDC_BASE_SEPOLIA } from "../../../../packages/shared/src/abi";

try { process.loadEnvFile(new URL("../../../../.env", import.meta.url).pathname); } catch {}
const need = (name: string) => { const v = process.env[name]; if (!v) throw new Error(`${name} missing in .env`); return v; };

const transport = http(process.env.RPC_URL ?? "https://sepolia.base.org");
const owner = privateKeyToAccount(need("OWNER_PRIVATE_KEY") as Hex);
const agent = privateKeyToAccount(need("AGENT_PRIVATE_KEY") as Hex).address;
const factory = need("FACTORY_ADDRESS") as Hex;
const riskyOwner = need("RISKY_OWNER") as Hex;
const publicClient = createPublicClient({ chain: baseSepolia, transport });
const walletClient = createWalletClient({ account: owner, chain: baseSepolia, transport });
const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600);

async function createFunded(walletOwner: Hex, maxSpend: bigint, fund: bigint) {
  const hash = await walletClient.writeContract({
    address: factory, abi: reusableWalletFactoryAbi, functionName: "createWalletFor",
    args: [walletOwner, agent, USDC_BASE_SEPOLIA, maxSpend, expiresAt, 20]
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const wallet = parseEventLogs({ abi: reusableWalletFactoryAbi, eventName: "WalletCreatedFor", logs: receipt.logs })[0]?.args.wallet;
  if (!wallet) throw new Error("WalletCreatedFor not found");
  const fundHash = await walletClient.writeContract({ address: USDC_BASE_SEPOLIA, abi: erc20Abi, functionName: "transfer", args: [wallet, fund] });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });
  return wallet;
}

const main = await createFunded(owner.address, 1_000_000n, 1_000_000n);
const risky = await createFunded(riskyOwner, 100_000n, 100_000n);
console.log("Add to .env:");
console.log(`WALLET_ADDRESS=${main}`);
console.log("PERMISSION_ID=0");
console.log(`RISKY_WALLET_ADDRESS=${risky}`);
