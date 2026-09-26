import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  http,
  isAddress,
  zeroAddress,
  type Address,
} from "viem";
import { foundry } from "viem/chains";
import { merchantAbi, missionWalletAbi, reusableWalletAbi } from "../../../packages/shared/src/abis";
import { describeRevert, revertData } from "../../../packages/shared/src/revert";
import { planOffline, planWithClaude, type Plan } from "./planner";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No .env file: rely on the shell environment.
}

const [cardArg, ...goalWords] = process.argv.slice(2);
const goal = goalWords.join(" ").trim();
if (!cardArg || !goal) {
  console.error('Usage: npm run agent -- <card> "<task>"');
  console.error("<card> is the card number shown in the app: a wallet address, or <wallet>-<id> for multi-use cards.");
  process.exit(1);
}

const [walletPart, permissionPart, ...extra] = cardArg.split("-");
if (!isAddress(walletPart) || extra.length > 0 || (permissionPart !== undefined && !/^\d+$/.test(permissionPart))) {
  console.error(`"${cardArg}" is not a card number. Copy the command from the card's page in the app.`);
  process.exit(1);
}
const wallet: Address = walletPart;
const permissionId = permissionPart === undefined ? undefined : BigInt(permissionPart);

const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
// Local Anvil either way: 31337 from npm run demo, 84532 when npm run x402:local forks Base Sepolia.
const chainId = await createPublicClient({ transport: http(rpc) }).getChainId();
const chain = chainId === foundry.id ? foundry : { ...foundry, id: chainId, name: `Local fork (${chainId})` };
const publicClient = createPublicClient({ chain, transport: http(rpc) });

type Limits = { agent: Address; merchant: Address; left: bigint; usesLeft: number; expiresAt: bigint; status: string };

async function readCard(): Promise<Limits> {
  if (permissionId === undefined) {
    const read = <F extends "agent" | "allowedTarget" | "maxSpend" | "expiresAt" | "used" | "cancelled">(functionName: F) =>
      publicClient.readContract({ address: wallet, abi: missionWalletAbi, functionName });
    const [agent, merchant, maxSpend, expiresAt, used, cancelled] = await Promise.all([
      read("agent"), read("allowedTarget"), read("maxSpend"), read("expiresAt"), read("used"), read("cancelled"),
    ]);
    return {
      agent: agent as Address,
      merchant: merchant as Address,
      left: used ? 0n : (maxSpend as bigint),
      usesLeft: used ? 0 : 1,
      expiresAt: expiresAt as bigint,
      status: cancelled ? "cancelled" : used ? "used" : "active",
    };
  }
  const [agent, merchant, maxSpend, spent, expiresAt, maxUses, uses, revoked, asset] = await publicClient.readContract({
    address: wallet,
    abi: reusableWalletAbi,
    functionName: "permissions",
    args: [permissionId],
  });
  if (agent === zeroAddress) throw new Error("No such multi-use card");
  if (asset !== zeroAddress) throw new Error("That permission pays x402 services in USDC; it isn't a merchant card");
  return {
    agent,
    merchant,
    left: maxSpend - spent,
    usesLeft: maxUses - uses,
    expiresAt,
    status: revoked ? "cancelled" : uses >= maxUses || spent >= maxSpend ? "used" : "active",
  };
}

async function plan(merchant: string, items: { name: string; price: bigint }[]): Promise<Plan> {
  if (process.env.AGENT_PLANNER === "offline") return planOffline(goal, items);
  try {
    return await planWithClaude(goal, merchant, items);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    const reason = /authentication method/i.test(message) ? "no Anthropic credentials found" : message;
    console.log(`        Claude unavailable (${reason}); using the offline planner`);
    return planOffline(goal, items);
  }
}

const card = await readCard().catch(() => {
  console.error(`No card found at ${cardArg} on ${rpc}. Is the demo running, and is the number right?`);
  process.exit(1);
});
const [merchantName, catalog] = await Promise.all([
  publicClient.readContract({ address: card.merchant, abi: merchantAbi, functionName: "name" }),
  publicClient.readContract({ address: card.merchant, abi: merchantAbi, functionName: "items" }),
]).catch(() => {
  console.error(`The card's merchant ${card.merchant} has no shop on this chain, so there's nothing to buy.`);
  process.exit(1);
});

console.log(`Card    ${cardArg}`);
console.log(`Task    ${goal}`);
console.log(`Shop    ${merchantName}`);
console.log("Planning...");
const decision = await plan(merchantName, [...catalog]);

if (decision.action === "decline") {
  console.log(`Declined by the agent (${decision.planner}): ${decision.reason}`);
  process.exit(0);
}

const item = catalog[decision.itemId];
const value = item.price * BigInt(decision.quantity);
const order = `${decision.quantity} × ${item.name}`;
console.log(`Plan    ${order} for ${formatEther(value)} ETH (${decision.planner})`);
console.log(`        ${decision.reason}`);

const now = BigInt(Math.floor(Date.now() / 1000));
const warnings = [
  card.status !== "active" && `card is ${card.status}`,
  now > card.expiresAt && "card has expired",
  card.usesLeft <= 0 && "no uses left",
  value > card.left && `over the ${formatEther(card.left)} ETH left on the card`,
].filter(Boolean);
if (warnings.length) console.log(`Heads up: ${warnings.join(", ")}. Sending anyway; the card decides.`);

const data = encodeFunctionData({ abi: merchantAbi, functionName: "buy", args: [BigInt(decision.itemId), BigInt(decision.quantity)] });
const walletClient = createWalletClient({ account: card.agent, chain, transport: http(rpc) });

// A fixed gas limit skips estimation, so over-limit attempts are mined as reverts and show up as blocked in the app.
const gas = 500_000n;
const hash =
  permissionId === undefined
    ? await walletClient.writeContract({ address: wallet, abi: missionWalletAbi, functionName: "execute", args: [card.merchant, value, data, goal], gas })
    : await walletClient.writeContract({
        address: wallet,
        abi: reusableWalletAbi,
        functionName: "execute",
        args: [permissionId, card.merchant, value, data, goal],
        gas,
      });

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status === "success") {
  console.log(`Bought  ${order} at ${merchantName}`);
  console.log(`Tx      ${hash}`);
} else {
  console.log(`Blocked by the card: ${describeRevert(await revertData(publicClient.request, hash))}`);
  console.log(`Tx      ${hash}`);
  process.exit(2);
}
