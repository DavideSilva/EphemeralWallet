export type Address = `0x${string}`;

export type Mission = {
  wallet: Address;
  owner: Address;
  agent: Address;
  allowedTarget: Address;
  maxSpend: bigint;
  expiresAt: bigint;
  used: boolean;
};

export type AgentAction = {
  target: Address;
  value: bigint;
  calldata: `0x${string}`;
};
