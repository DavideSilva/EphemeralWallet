import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { createPublicClient, createWalletClient, http, parseEther, parseEventLogs } from "viem";
import { foundry } from "viem/chains";
import "./style.css";

const missionFactoryAbi = [
  {type:"function",name:"createMission",stateMutability:"payable",inputs:[{name:"agent",type:"address"},{name:"allowedTarget",type:"address"},{name:"maxSpend",type:"uint256"},{name:"expiresAt",type:"uint64"}],outputs:[{name:"wallet",type:"address"}]},
  {type:"event",name:"MissionCreated",inputs:[{indexed:true,name:"owner",type:"address"},{indexed:true,name:"agent",type:"address"},{indexed:true,name:"wallet",type:"address"},{indexed:false,name:"allowedTarget",type:"address"},{indexed:false,name:"maxSpend",type:"uint256"},{indexed:false,name:"expiresAt",type:"uint64"},{indexed:false,name:"fundedAmount",type:"uint256"}]}
] as const;

const reusableFactoryAbi = [
  {type:"function",name:"createWallet",stateMutability:"payable",inputs:[],outputs:[{name:"wallet",type:"address"}]},
  {type:"function",name:"lastWallet",stateMutability:"view",inputs:[{name:"",type:"address"}],outputs:[{type:"address"}]},
  {type:"event",name:"WalletCreated",inputs:[{indexed:true,name:"owner",type:"address"},{indexed:true,name:"wallet",type:"address"},{indexed:false,name:"fundedAmount",type:"uint256"}]}
] as const;

const reusableAbi = [
  {type:"function",name:"createPermission",stateMutability:"nonpayable",inputs:[{name:"agent",type:"address"},{name:"allowedTarget",type:"address"},{name:"maxSpend",type:"uint256"},{name:"expiresAt",type:"uint64"},{name:"maxUses",type:"uint32"},{name:"asset",type:"address"}],outputs:[{name:"permissionId",type:"uint256"}]},
  {type:"event",name:"PermissionCreated",inputs:[{indexed:true,name:"permissionId",type:"uint256"},{indexed:true,name:"agent",type:"address"},{indexed:true,name:"allowedTarget",type:"address"},{indexed:false,name:"maxSpend",type:"uint256"},{indexed:false,name:"expiresAt",type:"uint64"},{indexed:false,name:"maxUses",type:"uint32"}]}
] as const;

const DEFAULT_AGENT="0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

function App() {
  const [mode,setMode]=useState<"disposable"|"reusable">("disposable");
  const [status,setStatus]=useState("Ready");
  const [agent,setAgent]=useState(DEFAULT_AGENT);
  const [target,setTarget]=useState(import.meta.env.VITE_DEMO_SHOP ?? "");
  const [budget,setBudget]=useState("0.002");
  const [mission,setMission]=useState("");
  const [reusableWallet,setReusableWallet]=useState("");
  const [permissionId,setPermissionId]=useState("");
  const [maxUses,setMaxUses]=useState("3");

  const missionFactory=import.meta.env.VITE_FACTORY as `0x${string}`;
  const reusableFactory=import.meta.env.VITE_REUSABLE_FACTORY as `0x${string}`;

  async function clients(){
    const transport=http("http://127.0.0.1:8545");
    const publicClient=createPublicClient({chain:foundry,transport});
    const accounts=await publicClient.request({method:"eth_accounts"});
    const account=accounts[0];
    if(!account) throw new Error("No unlocked Anvil account found");
    const wallet=createWalletClient({account,chain:foundry,transport});
    return {wallet,publicClient,account};
  }

  async function createMission(){
    try {
      const {wallet,publicClient,account}=await clients();
      setStatus("Creating disposable mission...");
      const maxSpend=parseEther(budget);
      const hash=await wallet.writeContract({account,address:missionFactory,abi:missionFactoryAbi,functionName:"createMission",args:[agent as `0x${string}`,target as `0x${string}`,maxSpend,BigInt(Math.floor(Date.now()/1000)+600)],value:maxSpend});
      const receipt=await publicClient.waitForTransactionReceipt({hash});
      const logs=parseEventLogs({abi:missionFactoryAbi,eventName:"MissionCreated",logs:receipt.logs});
      const address=logs[0]?.args.wallet;
      if(!address) throw new Error("MissionCreated event not found");
      setMission(address);
      setStatus("Disposable mission active: one execution.");
    } catch(error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function createReusable(){
    try {
      const {wallet,publicClient,account}=await clients();
      setStatus("Creating reusable wallet...");
      const hash=await wallet.writeContract({account,address:reusableFactory,abi:reusableFactoryAbi,functionName:"createWallet",value:parseEther("0.01")});
      await publicClient.waitForTransactionReceipt({hash});
      const address=await publicClient.readContract({address:reusableFactory,abi:reusableFactoryAbi,functionName:"lastWallet",args:[account]});
      if(address==="0x0000000000000000000000000000000000000000") throw new Error("Reusable wallet was not created");
      setReusableWallet(address);
      setPermissionId("");
      setStatus("Reusable wallet ready. Now add a disposable permission.");
    } catch(error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function addPermission(){
    try {
      if(!reusableWallet) throw new Error("Create the reusable wallet first");
      const {wallet,publicClient,account}=await clients();
      setStatus("Adding permission...");
      const hash=await wallet.writeContract({account,address:reusableWallet as `0x${string}`,abi:reusableAbi,functionName:"createPermission",args:[agent as `0x${string}`,target as `0x${string}`,parseEther(budget),BigInt(Math.floor(Date.now()/1000)+600),Number(maxUses),"0x0000000000000000000000000000000000000000"]});
      await publicClient.waitForTransactionReceipt({hash});
      const nextId=await publicClient.readContract({address:reusableWallet as `0x${string}`,abi:[...reusableAbi,{type:"function",name:"nextPermissionId",stateMutability:"view",inputs:[],outputs:[{type:"uint256"}]}] as const,functionName:"nextPermissionId"});
      const id=nextId-1n;
      setPermissionId(id.toString());
      setStatus(`Permission #${id} active. Wallet can accept more permissions.`);
    } catch(error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  return <main>
    <p className="eyebrow">EPHEMERAL AGENT AUTHORITY</p>
    <h1>Give agents permission.<br/>Not control.</h1>
    <p className="lede">Choose maximum isolation with one wallet per mission, or reuse one wallet with multiple disposable permissions.</p>

    <div className="tabs">
      <button className={mode==="disposable" ? "active" : ""} onClick={()=>{setMode("disposable");setStatus("Disposable wallet mode");}}>Disposable wallet</button>
      <button className={mode==="reusable" ? "active" : ""} onClick={()=>{setMode("reusable");setStatus("Reusable wallet mode");}}>Reusable wallet</button>
    </div>
    <p className="mode-label">Selected: <strong>{mode==="disposable" ? "Disposable wallet" : "Reusable wallet"}</strong></p>

    <section>
      <label>Agent address<input value={agent} onChange={e=>setAgent(e.target.value)}/></label>
      <label>Allowed target<input value={target} onChange={e=>setTarget(e.target.value)}/></label>
      <label>Permission budget (ETH)<input value={budget} onChange={e=>setBudget(e.target.value)}/></label>

      {mode==="disposable" ? <>
        <button onClick={createMission}>Create one-time mission wallet</button>
        {mission && <><p><strong>Mission wallet</strong></p><code>{mission}</code><p><strong>Execute</strong></p><code>npm run agent -- {mission}</code></>}
      </> : <>
        <label>Maximum uses<input value={maxUses} onChange={e=>setMaxUses(e.target.value)}/></label>
        {!reusableWallet ? <button onClick={createReusable}>Create reusable wallet + fund 0.01 ETH</button> : <>
          <p><strong>Reusable wallet</strong></p><code>{reusableWallet}</code>
          <button onClick={addPermission}>Add permission</button>
        </>}
        {permissionId && <><p><strong>Permission #{permissionId}</strong></p><code>npm run permission-agent -- {reusableWallet} {permissionId}</code></>}
      </>}

      <code>{status}</code>
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App/>);