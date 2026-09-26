export const missionFactoryAbi = [
  {
    type: "function",
    name: "createMission",
    stateMutability: "payable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "allowedTarget", type: "address" },
      { name: "maxSpend", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
    ],
    outputs: [{ name: "wallet", type: "address" }],
  },
  {
    type: "event",
    name: "MissionCreated",
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "agent", type: "address" },
      { indexed: true, name: "wallet", type: "address" },
      { indexed: false, name: "allowedTarget", type: "address" },
      { indexed: false, name: "maxSpend", type: "uint256" },
      { indexed: false, name: "expiresAt", type: "uint64" },
      { indexed: false, name: "fundedAmount", type: "uint256" },
    ],
  },
] as const;

export const missionWalletAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "memo", type: "string" },
    ],
    outputs: [{ name: "result", type: "bytes" }],
  },
  { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "reclaim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "agent", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "allowedTarget", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "maxSpend", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "expiresAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "used", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "cancelled", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "event",
    name: "Executed",
    inputs: [
      { indexed: true, name: "agent", type: "address" },
      { indexed: true, name: "target", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
      { indexed: false, name: "data", type: "bytes" },
      { indexed: false, name: "memo", type: "string" },
    ],
  },
  {
    type: "event",
    name: "Cancelled",
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "refunded", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Reclaimed",
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
  { type: "error", name: "NotOwner", inputs: [] },
  { type: "error", name: "NotAgent", inputs: [] },
  { type: "error", name: "MissionAlreadyUsed", inputs: [] },
  { type: "error", name: "MissionExpired", inputs: [] },
  { type: "error", name: "MissionCancelled", inputs: [] },
  { type: "error", name: "InvalidTarget", inputs: [] },
  { type: "error", name: "SpendLimitExceeded", inputs: [] },
  { type: "error", name: "MissionStillActive", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
  { type: "error", name: "CallFailed", inputs: [{ name: "data", type: "bytes" }] },
] as const;

export const reusableFactoryAbi = [
  {
    type: "function",
    name: "createWallet",
    stateMutability: "payable",
    inputs: [],
    outputs: [{ name: "wallet", type: "address" }],
  },
  {
    type: "function",
    name: "lastWallet",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "WalletCreated",
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "wallet", type: "address" },
      { indexed: false, name: "fundedAmount", type: "uint256" },
    ],
  },
] as const;

export const reusableWalletAbi = [
  {
    type: "function",
    name: "createPermission",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "allowedTarget", type: "address" },
      { name: "maxSpend", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
      { name: "maxUses", type: "uint32" },
    ],
    outputs: [{ name: "permissionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "permissionId", type: "uint256" },
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "memo", type: "string" },
    ],
    outputs: [{ name: "result", type: "bytes" }],
  },
  {
    type: "function",
    name: "revokePermission",
    stateMutability: "nonpayable",
    inputs: [{ name: "permissionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "nextPermissionId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "permissions",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "agent", type: "address" },
      { name: "allowedTarget", type: "address" },
      { name: "maxSpend", type: "uint256" },
      { name: "spent", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
      { name: "maxUses", type: "uint32" },
      { name: "uses", type: "uint32" },
      { name: "revoked", type: "bool" },
    ],
  },
  {
    type: "event",
    name: "PermissionCreated",
    inputs: [
      { indexed: true, name: "permissionId", type: "uint256" },
      { indexed: true, name: "agent", type: "address" },
      { indexed: true, name: "allowedTarget", type: "address" },
      { indexed: false, name: "maxSpend", type: "uint256" },
      { indexed: false, name: "expiresAt", type: "uint64" },
      { indexed: false, name: "maxUses", type: "uint32" },
    ],
  },
  {
    type: "event",
    name: "PermissionRevoked",
    inputs: [{ indexed: true, name: "permissionId", type: "uint256" }],
  },
  {
    type: "event",
    name: "Executed",
    inputs: [
      { indexed: true, name: "permissionId", type: "uint256" },
      { indexed: true, name: "agent", type: "address" },
      { indexed: true, name: "target", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
      { indexed: false, name: "data", type: "bytes" },
      { indexed: false, name: "memo", type: "string" },
    ],
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
  { type: "error", name: "NotOwner", inputs: [] },
  { type: "error", name: "NotAgent", inputs: [] },
  { type: "error", name: "PermissionNotFound", inputs: [] },
  { type: "error", name: "PermissionIsRevoked", inputs: [] },
  { type: "error", name: "PermissionExpired", inputs: [] },
  { type: "error", name: "PermissionExhausted", inputs: [] },
  { type: "error", name: "InvalidTarget", inputs: [] },
  { type: "error", name: "SpendLimitExceeded", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
  { type: "error", name: "CallFailed", inputs: [{ name: "data", type: "bytes" }] },
] as const;

export const merchantAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "items",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "name", type: "string" },
          { name: "price", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [
      { name: "itemId", type: "uint256" },
      { name: "quantity", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Purchased",
    inputs: [
      { indexed: true, name: "buyer", type: "address" },
      { indexed: true, name: "itemId", type: "uint256" },
      { indexed: false, name: "quantity", type: "uint256" },
      { indexed: false, name: "paid", type: "uint256" },
    ],
  },
  { type: "error", name: "UnknownItem", inputs: [] },
  { type: "error", name: "InvalidQuantity", inputs: [] },
  { type: "error", name: "WrongPayment", inputs: [] },
] as const;
