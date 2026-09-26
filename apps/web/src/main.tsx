import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { createPublicClient, createWalletClient, custom, parseEther, parseEventLogs } from "viem";
import { foundry } from "viem/chains";
import "./style.css";

const factoryAbi = [
  {
    type:"function", name:"createMission", stateMutability:"payable",
    inputs:[{name:"agent",type:"address"},{name:"allowedTarget",type:"address"},{name:"maxSpend",type:"uint256"},{name:"expiresAt",type:"uint64"}],
    outputs:[{name:"wallet",type:"address"}]
  },
  {
    type:"event", name:"MissionCreated",
    inputs:[
      {indexed:true,name:"owner",type:"address"},
      {indexed:true,name:"agent",type:"address"},
      {indexed:true,name:"wallet",type:"address"},
      {indexed:false,name:"allowedTarget",type:"address"},
      {indexed:false,name:"maxSpend",type:"uint256"},
      {indexed:false,name:"expiresAt",type:"uint64"},
      {indexed:false,name:"fundedAmount",type:"uint256"}
    ]
  }
] as const;

const DEFAULT_AGENT="0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

function App() {
  const [status,setStatus]=useState("Ready");
  const [mission,setMission]=useState("");
  const [agent,setAgent]=useState(DEFAULT_AGENT);
  const [target,setTarget]=useState(import.meta.env.VITE_DEMO_SHOP ?? "");
  const [budget,setBudget]=useState("0.002");
  const factory=import.meta.env.VITE_FACTORY as `0x${string}`;

  async function ensureLocalChain(){
    if(!window.ethereum) throw new Error("Install an injected wallet");
    try {
      await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x7a69"}]});
    } catch {
      await window.ethereum.request({method:"wallet_addEthereumChain",params:[{
        chainId:"0x7a69",chainName:"Anvil Local",nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18},
        rpcUrls:["http://127.0.0.1:8545"]
      }]});
    }
  }

  async function createMission(){
    try {
      await ensureLocalChain();
      setStatus("Confirm mission in wallet...");
      const transport=custom(window.ethereum!);
      const walletClient=createWalletClient({chain:foundry,transport});
      const publicClient=createPublicClient({chain:foundry,transport});
      const [account]=await walletClient.requestAddresses();
      // Local demo only: give the connected address test ETH on Anvil.
      await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "anvil_setBalance",
          params: [account, "0x56BC75E2D63100000"]
        })
      });
      const maxSpend=parseEther(budget);
      const hash=await walletClient.writeContract({
        account,address:factory,abi:factoryAbi,functionName:"createMission",
        args:[agent as `0x${string}`,target as `0x${string}`,maxSpend,BigInt(Math.floor(Date.now()/1000)+600)],
        value:maxSpend
      });
      setStatus("Waiting for local transaction...");
      const receipt=await publicClient.waitForTransactionReceipt({hash});
      const logs=parseEventLogs({abi:factoryAbi,eventName:"MissionCreated",logs:receipt.logs});
      const wallet=logs[0]?.args.wallet;
      if(!wallet) throw new Error("MissionCreated event not found");
      setMission(wallet);
      setStatus("Mission active. Run the agent command below.");
    } catch(error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return <main>
    <p className="eyebrow">LOCAL ETHGLOBAL MVP</p>
    <h1>Give an agent money.<br/>Not a wallet.</h1>
    <p className="lede">Create a disposable local mission. One target. One budget. One execution. Ten minutes.</p>
    <section>
      <label>Agent address<input value={agent} onChange={e=>setAgent(e.target.value)} /></label>
      <label>Allowed target<input value={target} onChange={e=>setTarget(e.target.value)} placeholder="started by npm run demo"/></label>
      <label>Budget (ETH)<input value={budget} onChange={e=>setBudget(e.target.value)}/></label>
      <button onClick={createMission}>Create one-time mission</button>
      <code>{status}</code>
      {mission && <>
        <p><strong>Mission wallet</strong></p>
        <code>{mission}</code>
        <p><strong>Execute agent</strong></p>
        <code>npm run agent -- {mission}</code>
      </>}
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App/>);

declare global { interface Window { ethereum?: { request(args:any):Promise<any> } } }
