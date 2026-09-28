# Plan: Touch ID for held x402 payments, enforced on-chain

Status: **decided and reviewed; not yet implemented.** Delivered as a stack of PRs (see [PR stack](#pr-stack)).

## Goal

x402 payments that need the owner's say-so wait for the owner's **Touch ID**, and the **wallet contract** refuses them
without it, so a hacked agent (or anything holding only the agent key) can't push them through.

Today (`main`): a HOLD shows on `/payments` with an **Approve** button. It posts to the agent daemon
(`POST /holds/:id/approve`), which re-runs the payment with `approvedFor = {payTo, amount}`; `decide()` turns that into
PAY and the agent calls `approvePayment`. Nothing on-chain knows a human approved.

## Decisions

- **D1 = B.** The contract requires the owner's passkey approval for a payment when **either**:
  - the amount is over the threshold (0.25 USDC, matching `DEFAULT_POLICY.holdAbove`), **or**
  - the payee isn't a **known payee** of that permission yet, whatever the amount. A payee becomes known only when a
    passkey-approved payment to it goes through, and nothing else adds to that set.

  The attacker's own address is always new, so a hacked agent can't pay itself in small chunks (reviewers proved that
  option A alone lets it drain the budget with four 0.25 USDC payments).
- **D2 = 3.** The passkey is enrolled **before** the payment wallet is set up, and setup creates the payment
  permission **with the plugin from the start**. No permission on that wallet exists without it. The daemon never
  gets the owner key.

## The honest limits

- HOLDs that come only from Intercepta (Medium-risk authorization, CAUTION payee over its cap) are still the agent's
  call: the chain can't see Intercepta. They go through the same Touch ID path, so their approval is signed and
  recorded on-chain, but the contract doesn't force them.
- A hacked agent can still pay **known** payees small amounts (≤ 0.25 USDC each), within the budget (1 USDC) and uses
  (20). The money can only go to payees you approved before.
- Touch ID signs a 32-byte challenge the owner can't read. A hacked web app could show one payment and get a signature
  for another. The app is inside the trust boundary; the agent and daemon are not.
- The `risky` demo wallet (owner = a flagged address whose key we don't hold) stays without the plugin; the service's
  payer gate refuses it anyway.

## Design

### Contracts

1. **`ReusablePermissionWallet`**
   - `createPermissionWithHooks` accepts token permissions (drop `HooksNeedNativePermission`).
   - `approvePayment` gets the `_executing` re-entry guard.
   - After its checks and the `DOMAIN_SEPARATOR` call, and before recording the digest, it runs every plugin with
     `target = payTo`, `value = amount`, `data = ""`. The approval covers "pay this payee this amount", not a nonce,
     because the agent's retry after approval gets a fresh x402 authorization.
   - `_runHooks` gets a `bytes memory` variant.
   - A plugin rejection rolls back `_consume`, the nonce and the digest (one transaction).
2. **`ApprovalHook`**
   - New optional config word: `abi.encode(threshold, x, y, rpIdHash, uint256 flags)`, where bit 0 means "unknown
     payees need approval". Card configs (1 or 4 words) are unchanged.
   - State `knownPayee[wallet][permissionId][payee]`, set only when an approval is used.
   - `beforeExecute` needs an approval when `value > threshold`, or when the flag is set and the payee is unknown.
   - Views for the agent and app: `needsApproval(wallet, permissionId, target, value)` and `isKnownPayee(...)`.
   - Passkey mode accepts the 4-word and 5-word configs; `approve` (owner account) stays for 1-word configs only.
   - Units: the threshold is in the permission's asset units (USDC: 6 decimals; ETH cards: wei). This is documented
     and the names say so.

### Setup and enrollment (D2 = 3)

1. `npm run demo` starts the web app **before** `x402:setup`, then prints "Open http://localhost:5173/payments and tap
   Touch ID to protect payments".
2. `/payments` shows **Protect payments with Touch ID** when setup is waiting:
   - it uses the stored passkey or creates one (one Touch ID prompt the first time);
   - it POSTs the public key to a short-lived loopback endpoint that `demo.mjs` runs only during setup. The endpoint is
     JSON-only, checks the UI Origin, and accepts one call.
   - A browser that already has a passkey from an earlier run still has to press the button, so the owner confirms
     each run.
3. `x402:setup` (owner key, as today) creates the main payment wallet with `createWallet()` +
   `createPermissionWithHooks(agent, anyPayee, 1 USDC, 7 days, 20 uses, USDC, [{ApprovalHook, config}])`, so
   permission 0 **is** the protected one. It no longer uses `createWalletFor` for the main wallet.
4. If nobody enrolls within a time limit, the demo stops with a clear message. It does not quietly create an
   unprotected wallet.

### Agent and daemon

- **`guarded-signer`:** after `decide()` returns PAY or CAP, it asks the plugin `needsApproval(...)`. If approval is
  needed and there's no live on-chain approval (`approvedUntil(requestKey) >= now`), the verdict becomes **HOLD**
  ("needs your Touch ID: new payee" or "over 0.25 USDC"), so the agent holds instead of sending a doomed transaction.
- **`store.Hold`** records `wallet`, `permissionId` and `hook`, and the daemon exposes them to the UI.
- **`wallet.ts`:** simulates `approvePayment` before sending and decodes `HookRejected` → `ApprovalRequired` into
  "needs Touch ID". The daemon reopens the hold with that message.
- **Rogue-agent script:** `npm --workspace @eaw/agent run x402:rogue` calls `approvePayment` straight to a fresh
  address and shows the contract refusing it. It works without an Intercepta key.

### Web `/payments`

- **Approve with Touch ID** on a hold:
  1. prefetch the plugin challenge for `(wallet, permissionId, payTo, amount, "0x")`;
  2. Touch ID signs it;
  3. the app relays `approveWithPasskey` (Anvil #0 on the fork; anyone may relay);
  4. then it calls `POST /holds/:id/approve`.
- The button is disabled while a request is in flight. **Reject** is unchanged.
- A hold whose approval was used but whose re-screening then refused shows as "refused after approval".

## Tests

- **Foundry:**
  - plugins on `approvePayment`: run, hold, consume nothing, record no digest;
  - the re-entry guard;
  - the new-payee rule: an unknown payee is held at any amount, a known payee under the threshold passes, and only an
    approved payment makes a payee known;
  - over the threshold still needs approval for a known payee;
  - the split-drain attack is blocked;
  - approvals are single-use and can't be replayed, and a wrong payee or amount fails;
  - the setup path leaves no unprotected permission;
  - `X402ForkTest` with the plugin, paying real USDC.
- **vitest:** signer HOLD on `needsApproval`, revert decoding, hold fields, the enrollment endpoint guards.
- **End to end** on `npm run demo`:
  - rogue agent refused;
  - first `/dataset` payment held (new payee) → Touch ID → paid;
  - the second `/dataset` paid automatically;
  - `/bulk-dataset` (0.30) held → Touch ID → paid.
  - The screening-dependent steps need `INTERCEPTA_API_KEY`; without it every payment is refused before any HOLD.

## PR stack

| # | Branch | Contents |
|---|---|---|
| 0 | `x402-hold/0-plan` | This plan |
| 1 | `x402-hold/1-contracts` | Plugins on `approvePayment`, guard, new-payee rule, tests, SPEC, ABIs |
| 2 | `x402-hold/2-enroll-setup` | Enrollment endpoint + page, setup creates the protected permission, demo wiring |
| 3 | `x402-hold/3-agent` | Signer HOLD on `needsApproval`, revert decoding, hold fields, rogue-agent script |
| 4 | `x402-hold/4-web` | Approve with Touch ID on `/payments`, README, end-to-end run |

## Review record

Reviewed by two Claude agents (security, which proved findings with Foundry tests; and feasibility/UX) and GLM-5.3 via
opencode; a Kimi K3 run returned nothing. Changes that came out of the review:

- revoke/avoid the unprotected permission 0 (critical, proved);
- option A alone lets a hacked agent drain the budget in small payments (critical, proved), which led to D1 = B;
- the re-entry guard is missing on `approvePayment`;
- holds need wallet and permission ids;
- decode `HookRejected` for a clear "needs Touch ID";
- do not give the daemon the owner key;
- state the app trust limit;
- the threshold units.
