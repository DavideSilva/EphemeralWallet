import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, http } from "viem";
import { foundry } from "viem/chains";
import { validateAction } from "./index";

const walletAbi = [
  {type:"function",name:"execute",stateMutability:"nonpayable",inputs:[{name:"target",type:"address"},{name:"value",type:"uint256"},{name:"data",type:"bytes"},{name:"memo",type:"string"}],outputs:[{name:"result",type:"bytes"}]},
  {type:"function",name:"owner",stateMutability:"view",inputs:[],outputs:[{type:"address"}]},
  {type:"function",name:"agent",stateMutability:"view",inputs:[],outputs:[{type:"address"}]},
  {type:"function",name:"allowedTarget",stateMutability:"view",inputs:[],outputs:[{type:"address"}]},
  {type:"function",name:"maxSpend",stateMutability:"view",inputs:[],outputs:[{type:"uint256"}]},
  {type:"function",name:"expiresAt",stateMutability:"view",inputs:[],outputs:[{type:"uint64"}]},
  {type:"function",name:"used",stateMutability:"view",inputs:[],outputs:[{type:"bool"}]}
] as const;
const merchantAbi=[
  {type:"function",name:"items",stateMutability:"view",inputs:[],outputs:[{type:"tuple[]",components:[{name:"name",type:"string"},{name:"price",type:"uint256"}]}]},
  {type:"function",name:"buy",stateMutability:"payable",inputs:[{name:"itemId",type:"uint256"},{name:"quantity",type:"uint256"}],outputs:[]}
] as const;

const missionWallet=(process.argv[2] ?? process.env.MISSION_WALLET) as `0x${string}`;
const rpc=process.env.RPC_URL ?? "http://127.0.0.1:8545";
const goal=process.argv[3] ?? "";
if(!missionWallet) throw new Error("Usage: npm run agent -- <mission-wallet> [goal]");

const publicClient=createPublicClient({chain:foundry,transport:http(rpc)});
const [owner,agent,allowedTarget,maxSpend,expiresAt,used]=await Promise.all([
 publicClient.readContract({address:missionWallet,abi:walletAbi,functionName:"owner"}),
 publicClient.readContract({address:missionWallet,abi:walletAbi,functionName:"agent"}),
 publicClient.readContract({address:missionWallet,abi:walletAbi,functionName:"allowedTarget"}),
 publicClient.readContract({address:missionWallet,abi:walletAbi,functionName:"maxSpend"}),
 publicClient.readContract({address:missionWallet,abi:walletAbi,functionName:"expiresAt"}),
 publicClient.readContract({address:missionWallet,abi:walletAbi,functionName:"used"})
]);

const walletClient=createWalletClient({account:agent,chain:foundry,transport:http(rpc)});
const catalog=await publicClient.readContract({address:allowedTarget,abi:merchantAbi,functionName:"items"});
const itemId=BigInt(process.env.DEMO_ITEM ?? "0");
const item=catalog[Number(itemId)];
if(!item) throw new Error(`item ${itemId} not in catalog`);
const value=item.price;
const calldata=encodeFunctionData({abi:merchantAbi,functionName:"buy",args:[itemId,1n]});
try {
  validateAction({wallet:missionWallet,owner,agent,allowedTarget,maxSpend,expiresAt:BigInt(expiresAt),used},{target:allowedTarget,value,calldata},BigInt(Math.floor(Date.now()/1000)));
} catch (error) {
  const message=error instanceof Error ? error.message : String(error);
  console.error(`mission cannot be executed: ${message}`);
  process.exit(1);
}

console.log("mission",missionWallet);
console.log("agent",agent);
console.log("target",allowedTarget);
console.log(`executing purchase: ${item.name} for ${formatEther(value)} ETH`);

const hash=await walletClient.writeContract({address:missionWallet,abi:walletAbi,functionName:"execute",args:[allowedTarget,value,calldata,goal]});
console.log("submitted",hash);
await publicClient.waitForTransactionReceipt({hash});
console.log("mission executed; authority consumed");
