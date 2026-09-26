# Ephemeral Agent Authority — MVP Spec

## Goal

Give AI agents narrowly-scoped authority without giving them permanent control of funds.

The MVP supports two models that share the same permission concepts: **who can act, where, how much, how long, and how many times**. Mode B permissions can also pay x402 services in USDC (see "Mode B — token permissions (x402)").

## Mode A — disposable mission wallet

One wallet represents one mission.

Fields:
- owner
- agent
- allowedTarget
- maxSpend
- expiresAt
- used
- cancelled

Invariants:
- only the configured agent may execute
- one successful execution maximum
- only the configured target may be called
- value cannot exceed the mission budget
- execution stops after expiry
- owner can reclaim leftovers after execution or expiry
- owner can cancel an unused mission, which voids it and refunds the balance

Best for: maximum isolation between jobs.

## Mode B — reusable wallet with disposable permissions

One persistent wallet holds funds and can contain many independent permissions.

Each permission contains:
- agent
- allowedTarget
- maxSpend (cumulative)
- spent
- expiresAt
- maxUses
- uses
- revoked
- asset (`address(0)` = native ETH; otherwise an EIP-3009 token such as USDC)

Invariants:
- permissions are independent
- only the permission's agent can use it
- a native permission can call only its allowed target (`execute`); a token permission cannot `execute`
- cumulative spend cannot exceed maxSpend
- uses cannot exceed maxUses
- expired or revoked permissions cannot execute or approve payments
- revoking one permission does not affect others
- the owner can withdraw ETH (`withdraw`) and tokens (`withdrawToken`) without destroying the wallet
- the owner can hand the wallet to a new owner (`transferOwnership`)

Best for: agents that perform repeated jobs from a shared wallet.

## Mode B — token permissions (x402)

A permission with a non-zero `asset` lets the agent pay x402 services from the wallet. x402 on EVM is a USDC
`transferWithAuthorization` (EIP-3009) signed by the payer; here the payer is the wallet contract, which answers ERC-1271.

- `allowedTarget` is the only payee, or `address(0)` for any payee (the agent's screening decides who).
- `approvePayment(permissionId, payTo, amount, validAfter, validBefore, nonce)`: agent only. Applies every check above
  (budget, uses, expiry, revoked) plus: token permission only, `payTo != address(0)`, payee matches if pinned, a
  window that can settle now (`validAfter < validBefore` and `validBefore > block.timestamp`, else
  `InvalidAuthorizationWindow`), `validBefore <= expiresAt`, and a nonce not already approved by any permission. Spend and uses are consumed here, before any signature exists. The wallet computes the
  exact EIP-712 digest on-chain (from the token's `DOMAIN_SEPARATOR`, `from = address(this)`) and records it in
  `approvedDigest`; `approvedNonce[nonce] = permissionId + 1` lets a payee find the approving agent.
- `isValidSignature(hash, signature)` (ERC-1271) returns the magic value only for an approved digest. The signature bytes
  are ignored; callers pass more than 65 bytes so x402 facilitators take the contract-signer path.
- An approval pays exactly one authorization: the digest binds wallet, payee, amount, validity window, nonce and token,
  and the token's own nonce tracking plus `approvedNonce` prevent replay.

Known limitations:

- An approved but unsettled authorization stays valid until `validBefore`, even if the permission is revoked later
  (the agent caps that window at 15 minutes).
- Token scoping comes only from the asset's `DOMAIN_SEPARATOR()`. A token contract that returns another token's
  separator (say, real USDC's) makes approvals under its permission valid for that other token, beyond the other
  permission's budget. The owner must only whitelist genuine EIP-3009 tokens. Binding `isValidSignature` to
  `msg.sender == asset` would close this, but it would also break off-chain ERC-1271 verification (facilitators call it
  via `eth_call`), so it is not done.

## Factories

- `MissionFactory.createMission` deploys and funds one Mode A wallet.
- `ReusableWalletFactory.createWallet` deploys a Mode B wallet owned by the caller.
- `ReusableWalletFactory.createWalletFor(owner, agent, asset, maxSpend, expiresAt, maxUses)` deploys a Mode B wallet
  for any owner with one "any payee" permission (id 0). The factory owns the wallet only within that call. It is
  permissionless (the demo uses it to create a wallet for a flagged owner), so it emits
  `WalletCreatedFor(owner, wallet, creator)` rather than `WalletCreated`: a UI that binds wallets to their owner by
  event must only trust `WalletCreated`.

## Shared behavior

- every execution carries a `memo` (the agent's goal), emitted in `Executed`
- demo targets are `Merchant` contracts exposing an on-chain catalog (`items()`) and `buy(itemId, quantity)` at exact catalog price

## Demo story

### Disposable
Create mission -> fund wallet -> agent executes -> authority consumed -> second attempt fails.

### Reusable
Create reusable wallet -> fund once -> create Permission A and Permission B -> agents execute independently -> revoke/exhaust one permission -> wallet and other permissions remain active.

### x402 payments
Agent requests a paid endpoint -> 402 -> Intercepta screens payee, token and authorization -> PAY/CAP: `approvePayment` then the facilitator settles; HOLD: owner approves or rejects; REFUSE: nothing is signed. The service separately screens the paying wallet, its owner and its agent before it settles.
