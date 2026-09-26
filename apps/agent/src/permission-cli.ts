import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, http } from "viem";
import { foundry } from "viem/chains";

const reusableAbi = [
  {type:"function",name:"execute",stateMutability:"nonpayable",inputs:[{name:"permissionId",type:"uint256"},{name:"target",type:"address"},{name:"value",type:"uint256"},{name:"data",type:"bytes"},{name:"memo",type:"string"}],outputs:[{type:"bytes"}]},
  {type:"function",name:"permissions",stateMutability:"view",inputs:[{name:"",type:"uint256"}],outputs:[
    {name:"agent",type:"address"},{name:"allowedTarget",type:"address"},{name:"maxSpend",type:"uint256"},{name:"spent",type:"uint256"},
    {name:"expiresAt",type:"uint64"},{name:"maxUses",type:"uint32"},{name:"uses",type:"uint32"},{name:"revoked",type:"bool"}
  ]}
] as const;
const merchantAbi=[
  {type:"function",name:"items",stateMutability:"view",inputs:[],outputs:[{type:"tuple[]",components:[{name:"name",type:"string"},{name:"price",type:"uint256"}]}]},
  {type:"function",name:"buy",stateMutability:"payable",inputs:[{name:"itemId",type:"uint256"},{name:"quantity",type:"uint256"}],outputs:[]}
] as const;

function cannotExecute(message: string): never {
  console.log(`permission not executed: ${message}`);
  process.exit(0);
}

const wallet=process.argv[2] as `0x${string}`;
const rawPermissionId=process.argv[3];
const goal=process.argv[4] ?? "";
if(!wallet || rawPermissionId === undefined) throw new Error("Usage: npm run permission-agent -- <wallet> <permission-id> [goal]");
const permissionId=BigInt(rawPermissionId);

const rpc=process.env.RPC_URL ?? "http://127.0.0.1:8545";
const publicClient=createPublicClient({chain:foundry,transport:http(rpc)});
const permission=await publicClient.readContract({address:wallet,abi:reusableAbi,functionName:"permissions",args:[permissionId]});
const [agent,allowedTarget,maxSpend,spent,expiresAt,maxUses,uses,revoked]=permission;

if(revoked) cannotExecute("Permission revoked");
if(BigInt(Math.floor(Date.now()/1000)) > BigInt(expiresAt)) cannotExecute("Permission expired");
if(uses >= maxUses) cannotExecute("Permission exhausted");

const catalog=await publicClient.readContract({address:allowedTarget,abi:merchantAbi,functionName:"items"});
const itemId=BigInt(process.env.DEMO_ITEM ?? "0");
const item=catalog[Number(itemId)];
if(!item) cannotExecute(`item ${itemId} not in catalog`);
const value=item.price;
if(spent + value > maxSpend) cannotExecute("Permission budget exceeded");

const calldata=encodeFunctionData({abi:merchantAbi,functionName:"buy",args:[itemId,1n]});
const walletClient=createWalletClient({account:agent,chain:foundry,transport:http(rpc)});

console.log(`permission #${permissionId}: use ${Number(uses)+1}/${maxUses}`);
console.log(`executing purchase: ${item.name} for ${formatEther(value)} ETH`);
const hash=await walletClient.writeContract({
  address:wallet,abi:reusableAbi,functionName:"execute",
  args:[permissionId,allowedTarget,value,calldata,goal]
});
await publicClient.waitForTransactionReceipt({hash});
console.log("executed",hash);
