import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, parseEther, stringToBytes } from "viem";
import { foundry } from "viem/chains";
import { validateAction } from "./index";

const walletAbi = [
  {type:"function",name:"execute",stateMutability:"nonpayable",inputs:[{name:"target",type:"address"},{name:"value",type:"uint256"},{name:"data",type:"bytes"}],outputs:[{name:"result",type:"bytes"}]},
  {type:"function",name:"owner",stateMutability:"view",inputs:[],outputs:[{type:"address"}]},
  {type:"function",name:"agent",stateMutability:"view",inputs:[],outputs:[{type:"address"}]},
  {type:"function",name:"allowedTarget",stateMutability:"view",inputs:[],outputs:[{type:"address"}]},
  {type:"function",name:"maxSpend",stateMutability:"view",inputs:[],outputs:[{type:"uint256"}]},
  {type:"function",name:"expiresAt",stateMutability:"view",inputs:[],outputs:[{type:"uint64"}]},
  {type:"function",name:"used",stateMutability:"view",inputs:[],outputs:[{type:"bool"}]}
] as const;
const shopAbi=[{type:"function",name:"buy",stateMutability:"payable",inputs:[{name:"item",type:"bytes32"}],outputs:[]}] as const;

const missionWallet=(process.argv[2] ?? process.env.MISSION_WALLET) as `0x${string}`;
const rpc=process.env.RPC_URL ?? "http://127.0.0.1:8545";
if(!missionWallet) throw new Error("Usage: npm run agent -- <mission-wallet>");

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
const value=parseEther(process.env.DEMO_PRICE_ETH ?? "0.001");
const item=keccak256(stringToBytes(process.env.DEMO_ITEM ?? "coffee"));
const calldata=encodeFunctionData({abi:shopAbi,functionName:"buy",args:[item]});
validateAction({wallet:missionWallet,owner,agent,allowedTarget,maxSpend,expiresAt:BigInt(expiresAt),used},{target:allowedTarget,value,calldata},BigInt(Math.floor(Date.now()/1000)));

console.log("mission",missionWallet);
console.log("agent",agent);
console.log("target",allowedTarget);
console.log("executing purchase: coffee for 0.001 ETH");

const hash=await walletClient.writeContract({address:missionWallet,abi:walletAbi,functionName:"execute",args:[allowedTarget,value,calldata]});
console.log("submitted",hash);
await publicClient.waitForTransactionReceipt({hash});
console.log("mission executed; authority consumed");
