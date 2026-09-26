# Ephemeral Agent Wallet — MVP Spec

## Goal
A user creates a mission that gives one agent narrowly-scoped, one-time authority to perform one on-chain action. The authority is unusable after execution or expiry, and the owner can reclaim remaining funds.

## Mission fields
- owner: address
- agent: address
- allowedTarget: address
- asset: address (`address(0)` for native ETH in the first MVP)
- maxSpend: uint256
- expiresAt: uint64
- used: bool

## Invariants
- Only `agent` may execute.
- Execution may happen at most once.
- Execution cannot happen after `expiresAt`.
- Agent cannot spend more than `maxSpend`.
- Agent cannot call any address except `allowedTarget`.
- Owner can reclaim remaining native funds after execution or expiry.

## State model
CREATED -> ACTIVE -> EXECUTED -> CLOSED
                   \-> EXPIRED -> CLOSED

## MVP demo
1. User creates a mission.
2. User funds the mission with native ETH.
3. Agent receives mission constraints.
4. Agent constructs calldata for the allowed target.
5. Agent executes once.
6. UI shows authority consumed.
7. A second execution attempt reverts.
8. Owner reclaims remaining ETH.
