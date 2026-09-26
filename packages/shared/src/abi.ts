export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

export const reusableWalletAbi = [
  {type:"function",name:"owner",stateMutability:"view",inputs:[],outputs:[{type:"address"}]},
  {type:"function",name:"permissions",stateMutability:"view",inputs:[{name:"",type:"uint256"}],outputs:[
    {name:"agent",type:"address"},{name:"allowedTarget",type:"address"},{name:"maxSpend",type:"uint256"},{name:"spent",type:"uint256"},
    {name:"expiresAt",type:"uint64"},{name:"maxUses",type:"uint32"},{name:"uses",type:"uint32"},{name:"revoked",type:"bool"},{name:"asset",type:"address"}
  ]},
  {type:"function",name:"approvedNonce",stateMutability:"view",inputs:[{name:"",type:"bytes32"}],outputs:[{type:"uint256"}]},
  {type:"function",name:"approvePayment",stateMutability:"nonpayable",inputs:[
    {name:"permissionId",type:"uint256"},{name:"payTo",type:"address"},{name:"amount",type:"uint256"},
    {name:"validAfter",type:"uint256"},{name:"validBefore",type:"uint256"},{name:"nonce",type:"bytes32"}
  ],outputs:[{name:"digest",type:"bytes32"}]}
] as const;

export const reusableWalletFactoryAbi = [
  {type:"function",name:"createWalletFor",stateMutability:"nonpayable",inputs:[
    {name:"owner",type:"address"},{name:"agent",type:"address"},{name:"asset",type:"address"},
    {name:"maxSpend",type:"uint256"},{name:"expiresAt",type:"uint64"},{name:"maxUses",type:"uint32"}
  ],outputs:[{name:"wallet",type:"address"}]},
  {type:"event",name:"WalletCreated",inputs:[{indexed:true,name:"owner",type:"address"},{indexed:true,name:"wallet",type:"address"},{indexed:false,name:"fundedAmount",type:"uint256"}]}
] as const;

export const erc20Abi = [
  {type:"function",name:"transfer",stateMutability:"nonpayable",inputs:[{name:"to",type:"address"},{name:"amount",type:"uint256"}],outputs:[{type:"bool"}]},
  {type:"function",name:"balanceOf",stateMutability:"view",inputs:[{name:"",type:"address"}],outputs:[{type:"uint256"}]}
] as const;
