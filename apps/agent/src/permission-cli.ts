import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, parseEther, stringToBytes } from "viem";
import { foundry } from "viem/chains";

const reusableAbi = [
  {type:"function",name:"execute",stateMutability:"nonpayable",inputs:[{name:"permissionId",type:"uint256"},{name:"target",type:"address"},{name:"value",type:"uint256"},{name:"data",type:"bytes"}],outputs:[{type:"bytes"}]},
  {type:"function",name:"permissions",stateMutability:"view",inputs:[{name:"",type:"uint256"}],outputs:[
    {name:"agent",type:"address"},{name:"allowedTarget",type:"address"},{name:"maxSpend",type:"uint256"},{name:"spent",type:"uint256"},
    {name:"expiresAt",type:"uint64"},{name:"maxUses",type:"uint32"},{name:"uses",type:"uint32"},{name:"revoked",type:"bool"},{name:"asset",type:"address"}
  ]}
] as const;
const shopAbi=[{type:"function",name:"buy",stateMutability:"payable",inputs:[{name:"item",type:"bytes32"}],outputs:[]}] as const;

function cannotExecute(message: string): never {
  console.log(`permission not executed: ${message}`);
  process.exit(0);
}

const wallet=process.argv[2] as `0x${string}`;
const rawPermissionId=process.argv[3];
if(!wallet || rawPermissionId === undefined) throw new Error("Usage: npm run permission-agent -- <wallet> <permission-id>");
const permissionId=BigInt(rawPermissionId);

const rpc=process.env.RPC_URL ?? "http://127.0.0.1:8545";
const publicClient=createPublicClient({chain:foundry,transport:http(rpc)});
const permission=await publicClient.readContract({address:wallet,abi:reusableAbi,functionName:"permissions",args:[permissionId]});
const [agent,allowedTarget,maxSpend,spent,expiresAt,maxUses,uses,revoked,asset]=permission;

if(revoked) cannotExecute("Permission revoked");
if(BigInt(Math.floor(Date.now()/1000)) > BigInt(expiresAt)) cannotExecute("Permission expired");
if(uses >= maxUses) cannotExecute("Permission exhausted");

const value=parseEther(process.env.DEMO_PRICE_ETH ?? "0.001");
if(spent + value > maxSpend) cannotExecute("Permission budget exceeded");

const item=keccak256(stringToBytes(process.env.DEMO_ITEM ?? "coffee"));
const calldata=encodeFunctionData({abi:shopAbi,functionName:"buy",args:[item]});
const walletClient=createWalletClient({account:agent,chain:foundry,transport:http(rpc)});

console.log(`permission #${permissionId}: use ${Number(uses)+1}/${maxUses}`);
console.log("executing purchase: coffee for 0.001 ETH");
const hash=await walletClient.writeContract({
  address:wallet,abi:reusableAbi,functionName:"execute",
  args:[permissionId,allowedTarget,value,calldata]
});
await publicClient.waitForTransactionReceipt({hash});
console.log("executed",hash);
