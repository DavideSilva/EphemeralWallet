# Plan: card plugins + "Touch ID for big buys"

Status: **implemented** in the PR stack below. User-facing docs: `README.md` ("Touch ID for big purchases") and `SPEC.md` ("Mode B — plugins").

## Goal

1. **Core:** a multi-use card (a permission on `ReusablePermissionWallet`) can carry plugins ("hooks") that run around every purchase and can hold it.
2. **Example plugin:** "Touch ID for big buys". Purchases at or under a threshold go through as today. Purchases above it are held until the owner approves that exact purchase with a passkey (Touch ID on a Mac), verified on-chain.

What the audience sees:

```
Card shows: "Touch ID above 0.005 ETH"
Agent: buy 2 cinema tickets        -> Bought
Agent: buy 5 concert tickets       -> Held: waiting for Touch ID
Card page: "Approve 5 × Concert ticket, 0.025 ETH at Ticket office?"  [Approve with Touch ID]
Owner touches the sensor           -> Approved
Agent retries by itself            -> Bought
```

Pitch line: small buys go through on their own; big ones need your fingerprint, and the app's own key can't fake it.

## Starting point

Based on `main` @ ebd1cc9 (after #7, x402 payments with Intercepta screening).

- `ReusablePermissionWallet` has two ways to spend. Both call `_consume()`, which runs the built-in checks and consumes uses and budget in one step:
  - `execute(permissionId, target, value, data, memo)`: merchant purchases in ETH. **This plan covers this path.**
  - `approvePayment(...)`: x402 payments in USDC.
- `createPermission` takes 6 arguments; the last is `asset` (`address(0)` = ETH).
- The `permissions()` tuple has 9 fields, with `asset` last.
- `owner` can change (`transferOwnership`).
- Custom errors are decoded by the app. The app shows reverted `execute` transactions as "Blocked" with a decoded reason (`apps/web/src/lib/data.ts` scans blocks and traces reverts).
- The one-time card (`EphemeralMissionWallet`) is **not changed**.
- The agent CLI (`apps/agent/src/cli.ts`) sends `execute` with a fixed 500k gas limit so over-limit attempts are mined as reverts.
- The web app signs as Anvil account #0 with no wallet popups. It reads events and blocks from `FROM_BLOCK` (0 on a fresh chain, the fork point on the Base Sepolia fork).
- x402 payments already have an **off-chain** owner approval: the agent can HOLD a payment and the owner approves or rejects it on `/payments` through the agent daemon. That flow is separate from this plan.
- `CLAUDE.md` rules that apply here: keep `SPEC.md` in sync with contract changes, and update `packages/shared/src/abis.ts` whenever a signature or the `permissions` tuple changes.

## Build in two stages

The review found the risky part is on-chain passkey verification plus browser passkey handling. So the work is split so the demo works end to end before that risk is taken on.

- **Stage A (about 6–7 h):** plugin system, an approval plugin where the **owner account** approves (no passkey yet), the agent waits and retries, the app shows Held → Approved → Bought. Fully demoable, but it must not be pitched as "only your fingerprint can approve".
- **Stage B (about 6 h):** the approval plugin verifies a **passkey signature** on-chain; the app creates and uses the passkey. From here the pitch line is true.

If Stage B slips, Stage A still ships.

## Design

### 1. Plugin interface — `IPermissionHook.sol`

```solidity
interface IPermissionHook {
    function beforeExecute(uint256 permissionId, address agent, address target,
                           uint256 value, bytes calldata data, bytes calldata config) external;
}
```

- `msg.sender` is the wallet; a hook keys any state by `(msg.sender, permissionId)`. Anyone can call `beforeExecute` directly, which is harmless because state is keyed by the caller.
- Only `beforeExecute` for now. `afterExecute` is left out until a plugin needs it (review: no consumer, extra edge cases).
- Hooks are trusted code chosen by the owner at issue time. They must not call back into the wallet (SPEC will say so).

### 2. Wallet changes — `ReusablePermissionWallet.sol`

- `struct Hook { address hook; bytes config; }`, stored per permission, **fixed at creation**. To change rules, revoke and reissue.
- `createPermissionWithHooks(agent, target, maxSpend, expiresAt, maxUses, asset, Hook[] hooks)` (owner only), with the same arguments as `createPermission` plus the hooks. The existing `createPermission` is unchanged and creates a permission with no hooks.
- Hooks are only allowed on native (`asset == address(0)`) permissions for now, since only `execute` runs them. Otherwise revert `HooksNeedNativePermission`.
- Reject: a hook address with no code, the same hook twice, more than 4 hooks.
- `hooksOf(permissionId) view returns (Hook[])`; event `HookAttached(permissionId, hook, config)`.
- `execute` signature and the `permissions()` getter tuple are **unchanged** (`data.ts` destructures it by position).
- Inside `execute`: `_consume()` (built-in checks + consume uses/spend) → native-asset and target checks → each hook's `beforeExecute` → call merchant → events. If a hook reverts, the consumption is rolled back with it.
- `approvePayment` does not run hooks in this plan.
- A hook's rejection is wrapped as `HookRejected(address hook, bytes reason)` so a hook can't impersonate a built-in error; `revert.ts` decodes the inner reason.
- Add a reentrancy guard on `execute`.

### 3. Approval plugin — `ApprovalHook.sol`

Config per permission: `abi.encode(uint256 threshold, ...)`; Stage B adds the passkey fields.

State:

- `approvedUntil[requestKey]` — a one-use approval with an expiry.
- `nonces[requestKey]` — per request, so approving one purchase doesn't invalidate a signature already being prepared for another.

`requestKey = keccak256(abi.encode(wallet, permissionId, target, value, keccak256(data)))`, exposed as a view so the app and agent never re-encode it themselves.

`beforeExecute`: if `value <= threshold`, allow. Otherwise require `approvedUntil[requestKey] >= block.timestamp`, delete it (one use) and emit `ApprovalUsed`; else revert `ApprovalRequired(requestKey)`.

`approve(wallet, permissionId, target, value, data, validUntil, ...)` records the approval and emits `Approved(wallet, permissionId, requestKey, validUntil)`:

- **Stage A:** only `wallet.owner()` may call it.
- **Stage B:** anyone may call it; the passkey signature is the authority.
  - Challenge: `keccak256(abi.encode(block.chainid, address(this), requestKey, nonces[requestKey], validUntil))`.
  - The signature is checked with solady `WebAuthn.verify(abi.encode(challenge), requireUV = true, auth, x, y)` using the P-256 precompile.
  - `authenticatorData[0:32]` must equal the `rpIdHash` stored in the config. Solady does not check the RP ID or origin itself; this closes that gap.
  - The config becomes `abi.encode(threshold, x, y, rpIdHash)`.

The plugin's constructor, or `Deploy.s.sol`, asserts `P256.hasPrecompileOrVerifier()`. Without the precompile every signature would silently fail.

> **Decided: per purchase.** The threshold applies to each purchase on its own. Known gap: an agent held on 5 tickets could buy 1 ticket five times, bounded only by the card's budget and uses. `SPEC.md` will say so. (The rejected alternative counted spend since the last approval.)

### 4. Chain and tooling

- `foundry.toml`: `evm_version = "osaka"`, so forge tests reach the P-256 precompile. This was tested with solc 0.8.24: the precompile is reachable, `vm.signP256` + `WebAuthn.verify` pass, and the existing tests still pass. The `--evm-version` CLI flag does **not** enable it; only the config setting does. Re-run the whole suite after the rebase onto #7.
- P-256 precompile at `0x100`, tested with a real signature:
  - **Plain Anvil (`npm run demo`):** available by default; no flag needed.
  - **Anvil fork of Base Sepolia (`npm run x402:local`):** **not** available by default, even though real Base Sepolia has it. It works with `--hardfork osaka` or `--optimism`. Add `--hardfork osaka` to `scripts/x402-local.mjs`, since that script also deploys the card contracts.
  - **Live chains:** Ethereum mainnet (EIP-7951), Base, Base Sepolia, Optimism and Arbitrum One all return valid.
- `scripts/demo.mjs` and `scripts/x402-local.mjs`: install solady v0.1.26 next to forge-std (`lib/` is gitignored).
- `.github/workflows/contracts.yml`: install solady.
- `Deploy.s.sol`: deploy `ApprovalHook`, log it; `demo.mjs` passes it as `VITE_APPROVAL_HOOK`.

### 5. Shared package

- `abis.ts`: wallet additions (`createPermissionWithHooks`, `hooksOf`, `HookAttached`, new errors) and an `approvalHookAbi`. The `permissions` tuple stays at 9 fields.
- `revert.ts`:
  - Add `revertName()`, which returns the error name, so code branches on names, never on display text.
  - Decode `HookRejected` → inner hook error.
  - Map `ApprovalRequired` → "Waiting for Touch ID".

### 6. Agent CLI

- On a revert named `ApprovalRequired`:
  - read the plugin address from `hooksOf(permissionId)`;
  - read `requestKey` from the revert (or the plugin's view);
  - print "Waiting for the owner to approve in the app…" with a countdown;
  - poll `approvedUntil(requestKey)` every second (5 min timeout, clean Ctrl-C);
  - re-read the card, then resend the **byte-identical** transaction.
- Exit code 2 if still held or blocked. Otherwise unchanged; the agent still isn't told its limits.

### 7. Web app

- **Card:** show a "Touch ID above X" badge, read from `hooksOf`, so the judge sees the rule before it fires.
- **Issuing (`cards.new.tsx`):** an optional "Require approval above ___" field for multi-use cards.
  - Stage B creates the passkey **before** any other awaits in the click handler (Safari user activation), using viem's `createWebAuthnCredential` with `authenticatorAttachment: "platform"` and `userVerification: "required"`.
  - Create **one** credential and reuse it: store `{id, publicKey}` in localStorage and only create when none exists. Re-registering can silently replace the old passkey.
  - Add a "reset passkey" link.
- **Blocked activity (`data.ts`):**
  - Carry structured `request {wallet, permissionId, target, value, data}` and `errorName` on each blocked item.
  - Work out approval state from the plugin's `Approved`/`ApprovalUsed` events on every snapshot, not from `approvedUntil`, because the blocked-scan cache is per block. Read the events from `FROM_BLOCK`, like the rest of `data.ts`.
  - Labels: **Held: waiting for Touch ID** (amber) → **Approved** → the following **Bought** row.
- **Approval banner:** on the card page, not in the activity row (the row is a link). It shows the purchase **decoded from calldata**: item, quantity, amount and merchant, never the agent's memo.
  - Stage B: prefetch the challenge, then call `toWebAuthnAccount({credential}).sign({hash: challenge})`. This gives `authenticatorData`, `clientDataJSON`, `challengeIndex`, `typeIndex` and a low-s `(r, s)`, matching solady's `WebAuthnAuth`.
  - Send `approve(...)` from the owner account.
  - Disable the button while an approval is pending.
- Open the app at `http://localhost:5173`, **not** `127.0.0.1`: passkeys don't work on IP addresses.

### 8. Tests (Foundry)

- **Wallet:**
  - hooks run and can hold a purchase with nothing consumed;
  - `createPermission` without hooks behaves as before (all existing tests, including the x402 ones from #7, still pass);
  - hooks on a token permission are rejected;
  - rejects hooks with no code, duplicate hooks, and more than 4 hooks;
  - only the owner can issue;
  - `HookRejected` wraps the reason;
  - re-entry is blocked.
- **Approval plugin:**
  - under the threshold passes;
  - over it is held;
  - an approval works once;
  - an approval for one purchase doesn't cover another;
  - an expired approval fails;
  - an approval on another permission or wallet doesn't apply.
  - Stage B adds: a valid passkey signature (`vm.signP256` plus hand-built `authenticatorData`/`clientDataJSON`), replay fails, missing user verification fails, wrong RP ID fails.

### 9. Docs

Half a page in `SPEC.md` (plugins, fixed at creation, ordering, trust model, approval invariants, the RP ID caveat) and the demo steps in `README.md`.

## PR stack

Each PR targets the one before it, so each is small and reviewable on its own.

| # | Branch | Base | Contents |
|---|---|---|---|
| 0 | `plugins/0-plan` | `main` | This plan |
| 1 | `plugins/1-hooks` | `plugins/0-plan` | Hook interface, wallet changes, tests, osaka config, solady install in demo/CI |
| 2 | `plugins/2-approval-hook` | `plugins/1-hooks` | Approval plugin (Stage A, owner approves), deploy, shared ABIs and revert names |
| 3 | `plugins/3-agent-wait` | `plugins/2-approval-hook` | Agent waits for approval and retries |
| 4 | `plugins/4-web-approval` | `plugins/3-agent-wait` | Card badge, issuing with a threshold, Held/Approved labels, approval banner. **Stage A demoable.** |
| 5 | `plugins/5-passkey-contract` | `plugins/4-web-approval` | On-chain passkey verification (RP ID, expiry, nonce), Foundry passkey tests |
| 6 | `plugins/6-passkey-web` | `plugins/5-passkey-contract` | Passkey create/sign in the app via viem |
| 7 | `plugins/7-docs` | `plugins/6-passkey-web` | SPEC, README, demo rehearsal notes |

## Out of scope

- The one-time card.
- x402 payments (`approvePayment`) and the existing off-chain HOLD approval on `/payments`. Two possible follow-ups, not decided:
  - run plugins on `approvePayment` too;
  - use Touch ID for x402 HOLD approvals.
- Declining without reverting ("soft deny"): only needed for plugins that must remember a blocked attempt.
- An extra `hookData` argument on `execute`: the approval travels on-chain through `approve()`.
- `afterExecute`, other plugins, hiding limits from the agent, hardware.

## Deviations from this plan

- solady is installed in PR 5 (where it is first used) rather than PR 1, together with `--hardfork osaka` for the Base
  Sepolia fork. Plain Anvil already has the P-256 precompile, so `demo.mjs` needed no hardfork flag.
- The approval plugin keeps both modes: threshold-only config means the owner account approves (Stage A), a config with
  a passkey means only the passkey can (Stage B). The app defaults to Touch ID when the browser supports passkeys.
- Verification used headless Chromium with a CDP virtual authenticator in place of Touch ID; a physical Touch ID run on
  the presenting Mac is still on the checklist below.

## Stage checklist

- [ ] Test Touch ID and the whole run on the presenting Mac, in the same browser profile (not incognito).
- [ ] Pre-create the passkey and cards before going on stage; one biometric prompt during the demo.
- [ ] Set the threshold so the planner's order reliably crosses it, or run with `AGENT_PLANNER=offline`.
- [ ] Record a full run as a backup video.

## Review record

Reviewed by three Claude agents (security, product and simplicity, WebAuthn and frontend) and two open-weight models via opencode (GLM-5.3, Kimi K3; a DeepSeek V4 Pro run returned no output). The main changes that came out of the review:

- the two-stage split;
- viem's WebAuthn helpers instead of hand-written parsing;
- the approval banner on the card page, with purchase details decoded from calldata;
- the RP ID check, approval expiry and per-request nonce;
- the `HookRejected` wrapper and the reentrancy guard;
- dropping `afterExecute`;
- the osaka `evm_version` setting, verified by experiment;
- the per-purchase vs running-total decision (decided: per purchase).

Updated after rebasing onto #7 (x402 payments):
- matched the new `createPermission`/`_consume` shape and 9-field tuple;
- limited hooks to native permissions;
- `FROM_BLOCK` for event reads;
- P-256 availability per environment, tested (the x402 fork needs `--hardfork osaka`);
- x402 payments listed as out of scope.
