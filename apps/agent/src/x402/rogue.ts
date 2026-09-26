import { BaseError, ContractFunctionRevertedError, createPublicClient, http, keccak256, stringToHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { reusableWalletAbi } from "../../../../packages/shared/src/abi";
import { decodeRevert, describeRevert } from "../../../../packages/shared/src/revert";
import { loadAgentConfig } from "./config";

// A hacked agent: it holds the agent key and skips screening entirely, calling the wallet directly to pay an address
// it controls. With the approval plugin on the permission, the wallet refuses without the owner's Touch ID.
// Needs no Intercepta key. Simulated with eth_call, so nothing is spent either way.
const config = loadAgentConfig();
const ref = config.wallets.default;
const agent = privateKeyToAccount(config.agentKey);
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) });
const thief = privateKeyToAccount(generatePrivateKey()).address;
const now = (await publicClient.getBlock()).timestamp;

async function attempt(label: string, amount: bigint) {
  try {
    await publicClient.simulateContract({
      account: agent,
      address: ref.wallet,
      abi: reusableWalletAbi,
      functionName: "approvePayment",
      args: [ref.permissionId, thief, amount, now - 600n, now + 300n, keccak256(stringToHex(`${label}-${now}`)) as Hex]
    });
    console.log(`  ${label}: WENT THROUGH. This wallet has no approval plugin (was the demo run with --no-touch-id?)`);
  } catch (error) {
    const reverted = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : undefined;
    const data = reverted instanceof ContractFunctionRevertedError ? reverted.raw : undefined;
    const name = decodeRevert(data)?.name;
    console.log(`  ${label}: refused by the wallet: ${name === "ApprovalRequired" ? "needs the owner's Touch ID" : describeRevert(data)}`);
  }
}

console.log(`Rogue agent ${agent.address} tries to pay ${thief} (a new address it controls) from wallet ${ref.wallet}:`);
await attempt("0.01 USDC", 10_000n);
await attempt("0.25 USDC", 250_000n);
await attempt("0.30 USDC", 300_000n);
