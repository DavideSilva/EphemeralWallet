# Safe Agent-to-Agent Payments — x402 + Intercepta — Design

Date: 2026-09-26
Status: approved in brainstorming, pending spec review

## Goal

Extend Ephemeral Agent Authority so agents pay each other over **x402** (USDC, EIP-3009) from a
**reusable permission wallet**, with every payment screened live by the **Intercepta API** before
the agent signs it and before the service accepts it. The verdict is visible in the flow and decides
what happens next: **pay, refuse, cap, or hold for a human**.

Targets the Intercepta ETHGlobal bounty, all three tracks:

1. Paying agent — screen `payTo`, token and the payment authorization; enforce spending limits.
2. Paid service / facilitator — screen the payer before verify/settle.
3. Counterparty risk — a risk profile with reasons for every wallet on the other side.

## Qualification checklist (must all hold)

- Working x402 payment flow on Base Sepolia (chain 84532), real testnet USDC.
- Live Intercepta calls run before signing (agent) and before settling (service); their result
  decides the outcome. No mocked responses outside unit tests.
- Screening targets real mainnet addresses (same address, mainnet history).
- Demo shows one payment that goes through and one blocked/held, with the reason visible.
- Public repo; README points to the files calling Intercepta and has 3–5 lines of API feedback.

## Spike findings (verified 2026-09-26)

- Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` is FiatToken v2.2 and exposes
  `transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)` (`0xcf092995`),
  which validates contract signers via ERC-1271. A fork test showed a contract wallet that approves a
  single digest can be paid from by any third-party submitter, and that an unapproved digest reverts.
- The x402 v2 facilitator (`@x402/evm`, exact scheme, EIP-3009) verifies with viem
  `publicClient.verifyTypedData` (ERC-1271 capable) and routes to the `bytes` variant when the signature
  is **longer than 65 bytes**. Our wallet signature must therefore be > 65 bytes.
- Intercepta endpoints only accept mainnet chain ids; we always screen with mainnet chain ids.

## Architecture

```
apps/service  (x402 paid API + own facilitator)        apps/web (Vite UI)
   GET /dataset          payTo = clean address            Payment feed / Held inbox / Counterparties
   GET /premium-dataset  payTo = risky mainnet address         │ polls
   GET /risk/:address    counterparty profile                  ▼
   verify/settle ── screens payer ──┐                   apps/agent (daemon + HTTP API)
                                    │                     x402 client loop
                                    ▼                     screens quote → policy → approve → pay
                          packages/risk  ◄───────────────────┘
                            intercepta.ts  (HTTP client, the only place calling Intercepta)
                            profile.ts     (counterparty profiles, cache)
                            policy.ts      (verdict engine)
                                    │
                         packages/contracts
                            ReusablePermissionWallet (ERC-1271 x402 payer)
                            ReusableWalletFactory (+ createWalletFor)
```

### Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `packages/risk/src/intercepta.ts` | Typed client: `quickScanAddress`, `deepScanAddress`, `summarizeAddress`, `scanToken`, `scanMessage`. 5 s timeout, no retries beyond one; throws `ScreeningUnavailable` on timeout / non-2xx / unparseable body. | `fetch`, `INTERCEPTA_API_KEY` |
| `packages/risk/src/profile.ts` | `getProfile(address)` → `{ address, tier, reasons[], labels[], screenedAt }`. Aggregates quick + deep scan + summarize. In-memory cache, 5 min TTL. | `intercepta.ts` |
| `packages/risk/src/policy.ts` | Pure function `decide(input) → Verdict`. No I/O. | types only |
| `packages/contracts` | On-chain final gate: permission limits + digest approval + ERC-1271. | USDC |
| `apps/agent` | Daemon: x402 client loop, custom wallet signer, hold queue, local HTTP API. | `risk`, `@x402/*`, viem |
| `apps/service` | x402 resource server with in-process facilitator; payer screening before verify/settle; profile endpoint. | `risk`, `@x402/*`, viem |
| `apps/web` | Existing UI + three new panels. | agent + service HTTP APIs |

Base URL `https://api.web3antivirus.io`, auth header `X-API-KEY`. Endpoints used:
`GET /api/public/v2/extension/account/{addr}/quick-scan`, Deep Scan Address, Summarize Address,
`GET /api/public/v2/extension/token-intelligence/token/{addr}/risks?chainId=`,
`POST /api/public/v2/extension/analysis/signature`.

## Contract changes

### `ReusablePermissionWallet`

- `Permission` gains `address asset` (`address(0)` = native ETH, existing behaviour; otherwise an
  EIP-3009 token, i.e. USDC). `createPermission` gains the `asset` parameter; web and agent callers
  are updated.
- For token permissions `allowedTarget == address(0)` means **any payee**: agents pay counterparties
  discovered at runtime, the contract bounds amount / time / uses, and Intercepta screening decides
  *who*. A non-zero `allowedTarget` still pins a single payee.
- `approvePayment(permissionId, payTo, amount, validAfter, validBefore, nonce)`:
  - only the permission's agent; not revoked; not expired; `uses < maxUses`;
    `spent + amount <= maxSpend`; payee matches if pinned; `validBefore <= expiresAt`.
  - consumes `uses += 1`, `spent += amount` at approval time.
  - computes the EIP-3009 digest on-chain using `IERC3009(asset).DOMAIN_SEPARATOR()` and the
    `TransferWithAuthorization` typehash with `from = address(this)`; stores
    `approvedDigest[digest] = true`; emits `PaymentApproved(permissionId, payTo, amount, nonce, digest)`.
- `isValidSignature(bytes32 hash, bytes sig) → 0x1626ba7e` iff `approvedDigest[hash]`, else `0xffffffff`.
  `sig` content is not trusted; it only needs to be > 65 bytes (we pass
  `abi.encode(permissionId, nonce, bytes32(0))`, 96 bytes).
- `withdrawToken(asset, amount)` — owner only.
- Existing ETH `execute` path and tests keep working.

Known limitation (accepted): budget is consumed at approval; an approved authorization that is never
settled stays counted until `validBefore` passes. No refund path in MVP.

### `ReusableWalletFactory`

- `createWalletFor(address owner)` — creates a wallet owned by `owner`. Used to demo a risky payer
  (owner = a known-risky mainnet address) while we still hold the permission's agent key.

## Paying-agent flow

1. `GET <service>/dataset` → `402` with `accepts[]` (`payTo`, `asset`, `amount`, `network`).
2. Build the candidate `TransferWithAuthorization` (from = wallet, random nonce, `validBefore` = now + 10 min).
3. Screen in parallel (live):
   - `getProfile(payTo)` (quick + deep + summarize),
   - `scanToken(asset)` — the canonical testnet USDC is mapped to mainnet USDC for the call; any other
     asset is screened as-is and flagged `non_canonical_token`,
   - `scanMessage` on the EIP-712 payload with `chainId: "8453"` and `from` = wallet.
4. `decide()` with the scans + on-chain permission state + agent-local policy config → verdict.
5. Act:
   - `PAY` → custom x402 signer calls `approvePayment` on-chain, returns the 96-byte sig; x402 client
     retries the request with `X-PAYMENT`.
   - `CAP` → pay only if `amount <= cap`; otherwise escalate to `HOLD`.
   - `HOLD` → enqueue in hold queue; loop waits; on human approve → `PAY` path; on reject → `REFUSE`.
   - `REFUSE` → no on-chain call, no signature.
6. Record a `Decision` `{ id, url, payTo, amount, verdict, reasons[], profile, txHash?, status }`.

The custom x402 signer (`address` = wallet, `signTypedData` = approve on-chain + return padded sig)
plugs into the standard `@x402/evm` exact client, so the payment payload is standard x402.

## Policy (`decide`)

Inputs: payee profile, token scan, message scan, permission state (`remaining = maxSpend - spent`,
uses left, expiry), config `{ holdAbove, capFraction, firstPaymentHoldAbove }`, and whether the payee
was paid before (from the decision log).

Evaluated in order; first match wins; every rule contributes a human-readable reason:

| Rule | Verdict |
|---|---|
| Any screening call unavailable | `REFUSE` ("screening unavailable — failing closed") |
| Payee tier `BLOCKED` (traits: `sanction_address`, `sanction_address_communication`, `known_scammer`, `attack_money_target`, `fake_phishing_*`, `blacklist`, `mixer_transfers` high risk) | `REFUSE` |
| Token not canonical USDC or token scan high risk | `REFUSE` |
| Message scan `riskGroup` high / dangerous detectors | `REFUSE` |
| Amount > remaining budget or no uses left or expired | `REFUSE` (mirrors contract) |
| Payee tier `CAUTION` | `CAP` with `cap = remaining * capFraction` (default 0.2); over cap → `HOLD` |
| Amount > `holdAbove`, or first payment to payee and amount > `firstPaymentHoldAbove` | `HOLD` |
| Otherwise | `PAY` |

Tier mapping in `profile.ts`: any blocking trait → `BLOCKED`; other traits with risk ≥ medium, or
deep-scan flags → `CAUTION`; none → `TRUSTED`. Exact risk thresholds are pinned against recorded
responses from the Discord test addresses during implementation.

## Paid-service flow

- Resource server paywalls `/dataset` (payTo = clean address we control) and `/premium-dataset`
  (payTo = a risky address from the Intercepta Discord pin; never paid, never needs a key).
- Before facilitator `verify`/`settle`: resolve payer identities — the wallet address, and if it has
  code, its `owner()` and the agent that approved the digest (from the `PaymentApproved` log) — and run
  `getProfile` on each. Any `BLOCKED` → respond `402` with `{ error: "payer_refused", reasons }`;
  unavailable → refuse (fail closed). Stretch: also screen USDC funders of the wallet.
- `GET /risk/:address` exposes `getProfile` for the UI and other agents.

## Agent daemon API (localhost)

- `POST /pay { url }` — run the loop against a URL.
- `GET /decisions` — decision log, newest first.
- `GET /holds`, `POST /holds/:id/approve`, `POST /holds/:id/reject`.
- `GET /profiles/:address` — proxied profile.

State is in memory (hackathon scope).

## UI (`apps/web`)

- **Payment feed**: each attempt with verdict badge (PAY / CAP / HOLD / REFUSE), amount, payee, and
  the reasons list inline; tx hash link to Base Sepolia explorer when settled.
- **Held payments**: pending holds with reasons, Approve / Reject.
- **Counterparties**: profile cards — tier, reasons, labels, screened-at.
- Wallet setup switches to Base Sepolia + USDC permissions (asset field, "any payee" option).

## Error handling

- Intercepta failure of any kind → `ScreeningUnavailable` → `REFUSE` on both sides, reason shown.
- Contract is the final gate: bypassing the policy engine cannot exceed budget/uses/expiry/payee pin.
- Facilitator settle failure → decision status `failed` with the revert reason; budget stays consumed
  (see known limitation).

## Configuration

`.env`: `RPC_URL` (Base Sepolia), `INTERCEPTA_API_KEY`, `AGENT_PRIVATE_KEY`, `OWNER_PRIVATE_KEY`,
`FACILITATOR_PRIVATE_KEY`, `WALLET_ADDRESS`, `PERMISSION_ID`, `CLEAN_PAYTO`, `RISKY_PAYTO`,
`RISKY_OWNER`. Anvil-fork mode is optional (RPC switch only) and not required for the demo.

## Testing

- Forge unit: `approvePayment` limits (agent, expiry, uses, budget, pinned payee, `validBefore`),
  digest equality with USDC's own hashing, `isValidSignature` true only for approved digests,
  `createWalletFor`.
- Forge fork test (Base Sepolia): wallet funded via `deal`, `approvePayment`, third party calls
  `transferWithAuthorization(..., bytes)` → payee receives USDC; unapproved digest reverts.
- TS unit: `decide()` table tests; `profile.ts` tier mapping against recorded Intercepta fixtures;
  `intercepta.ts` fail-closed on timeout / 500 / bad JSON (mocked `fetch`).
- E2E script on Base Sepolia (live Intercepta): (1) `/dataset` → PAY → settled; (2) `/premium-dataset`
  → REFUSE with reasons; (3) over-threshold payment → HOLD → approved in UI → settled;
  (4) risky-owner wallet → service refuses payer with reasons.

## README deliverables

- How to run the x402 demo; links to `packages/risk/src/intercepta.ts` (all API calls),
  `apps/agent/src/...` (payer gate) and `apps/service/src/...` (payee gate).
- 3–5 lines of Intercepta API feedback (time to first call, confusions, gaps — e.g. no testnet chain
  ids on Scan Message).

## Out of scope

Mode A mission wallets paying via x402, persistence beyond memory, refunds of unsettled approvals,
hosted x402.org facilitator, non-EVM chains, LLM planning.
