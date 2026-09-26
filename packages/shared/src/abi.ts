// x402 surface. Wallet and factory ABIs come from abis.ts so both stay in sync with the contracts.
export { approvalHookAbi, reusableWalletAbi, reusableFactoryAbi as reusableWalletFactoryAbi } from "./abis";

export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

export const erc20Abi = [
  {type:"function",name:"transfer",stateMutability:"nonpayable",inputs:[{name:"to",type:"address"},{name:"amount",type:"uint256"}],outputs:[{type:"bool"}]},
  {type:"function",name:"balanceOf",stateMutability:"view",inputs:[{name:"",type:"address"}],outputs:[{type:"uint256"}]}
] as const;
