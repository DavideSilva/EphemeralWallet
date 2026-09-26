# Ephemeral Agent Authority — MVP Spec

## Goal

Give AI agents narrowly-scoped authority without giving them permanent control of funds.

The MVP supports two models that share the same permission concepts: **who can act, where, how much, how long, and how many times**.

## Mode A — disposable mission wallet

One wallet represents one mission.

Fields:
- owner
- agent
- allowedTarget
- maxSpend
- expiresAt
- used

Invariants:
- only the configured agent may execute
- one successful execution maximum
- only the configured target may be called
- value cannot exceed the mission budget
- execution stops after expiry
- owner can reclaim leftovers after execution or expiry

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

Invariants:
- permissions are independent
- only the permission's agent can use it
- each permission can call only its allowed target
- cumulative spend cannot exceed maxSpend
- uses cannot exceed maxUses
- expired or revoked permissions cannot execute
- revoking one permission does not affect others
- the owner can withdraw funds without destroying the wallet

Best for: agents that perform repeated jobs from a shared wallet.

## Demo story

### Disposable
Create mission -> fund wallet -> agent executes -> authority consumed -> second attempt fails.

### Reusable
Create reusable wallet -> fund once -> create Permission A and Permission B -> agents execute independently -> revoke/exhaust one permission -> wallet and other permissions remain active.
