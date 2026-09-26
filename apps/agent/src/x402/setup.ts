import { createPublicClient, createWalletClient, encodeAbiParameters, http, parseEventLogs, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { erc20Abi, reusableWalletAbi, reusableWalletFactoryAbi, USDC_BASE_SEPOLIA } from "../../../../packages/shared/src/abi";

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

/** USDC has 6 decimals: payments over 0.25 USDC need the owner's Touch ID, like the agent's own hold threshold. */
const APPROVAL_THRESHOLD = 250_000n;
const UNKNOWN_PAYEES_NEED_APPROVAL = 1n;

/**
 * The main wallet, owned by the owner key, whose only permission (id 0) carries the approval plugin in passkey mode
 * with the unknown-payee rule: the agent key alone can't pay a new address or more than 0.25 USDC at once.
 */
async function createProtected(hook: Hex, x: Hex, y: Hex, rpIdHash: Hex, maxSpend: bigint, fund: bigint) {
  const created = await walletClient.writeContract({ address: factory, abi: reusableWalletFactoryAbi, functionName: "createWallet" });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: created });
  const wallet = parseEventLogs({ abi: reusableWalletFactoryAbi, eventName: "WalletCreated", logs: receipt.logs })[0]?.args.wallet;
  if (!wallet) throw new Error("WalletCreated not found");
  const config = encodeAbiParameters(
    [{ type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
    [APPROVAL_THRESHOLD, x, y, rpIdHash, UNKNOWN_PAYEES_NEED_APPROVAL]
  );
  const permission = await walletClient.writeContract({
    address: wallet, abi: reusableWalletAbi, functionName: "createPermissionWithHooks",
    args: [agent, zeroAddress, maxSpend, expiresAt, 20, USDC_BASE_SEPOLIA, [{ hook, config }]]
  });
  if ((await publicClient.waitForTransactionReceipt({ hash: permission })).status !== "success") throw new Error("createPermissionWithHooks failed");
  const fundHash = await walletClient.writeContract({ address: USDC_BASE_SEPOLIA, abi: erc20Abi, functionName: "transfer", args: [wallet, fund] });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });
  return wallet;
}

// Without an enrolled passkey (npm run demo -- --no-touch-id) the main wallet is created unprotected, as before.
const passkey = process.env.PASSKEY_X && process.env.PASSKEY_Y && process.env.PASSKEY_RP_ID_HASH && process.env.APPROVAL_HOOK;
const main = passkey
  ? await createProtected(
      need("APPROVAL_HOOK") as Hex, need("PASSKEY_X") as Hex, need("PASSKEY_Y") as Hex, need("PASSKEY_RP_ID_HASH") as Hex,
      1_000_000n, 1_000_000n
    )
  : await createFunded(owner.address, 1_000_000n, 1_000_000n);
console.log(passkey ? "Main wallet protected: new payees and payments over 0.25 USDC need the owner's Touch ID." : "Main wallet NOT protected (no passkey enrolled).");
const risky = await createFunded(riskyOwner, 100_000n, 100_000n);
console.log("Add to .env:");
console.log(`WALLET_ADDRESS=${main}`);
console.log("PERMISSION_ID=0");
console.log(`RISKY_WALLET_ADDRESS=${risky}`);
