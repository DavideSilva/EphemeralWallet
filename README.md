# Ephemeral Agent Wallet

Hackathon MVP for disposable, task-scoped agent authority.

> Give an AI agent a temporary capability, not a permanent wallet.

The project now demonstrates two models: **a disposable wallet per mission** for maximum isolation, and **a reusable wallet with multiple disposable permissions** for repeated agent activity.

## Run the demo locally

Requirements: Node.js/npm and Foundry (`anvil` + `forge`).

```bash
git clone https://github.com/DavideSilva/EphemeralWallet.git
cd EphemeralWallet
npm install
npm run demo
```

`npm run demo`:

1. starts Anvil on `127.0.0.1:8545`
2. installs `forge-std` if needed
3. deploys `MissionFactory` and `DemoShop`
4. injects their addresses into the Vite app
5. starts the UI at `http://localhost:5173`

Open the UI. It uses Anvil's first unlocked account on the local chain (chain ID 31337).

The default agent address in the UI is Anvil account #1. Create a mission with a budget of at least `0.001 ETH`. The UI waits for the transaction, extracts the new mission-wallet address from `MissionCreated`, and prints the command for the agent.

Run that command in a second terminal:

```bash
npm run agent -- <MISSION_WALLET>
```

The agent reads the constraints from the mission wallet, constructs a purchase of `coffee` from the allowed `DemoShop`, validates the target/budget/expiry locally, and executes it through Anvil's unlocked agent account.

Running the same command a second time should fail because the authority has already been consumed.

### Reusable wallet mode

Switch to **Reusable wallet** in the UI. Create and fund the wallet once, then add a permission with its own agent, target, cumulative budget, expiry, and maximum uses.

The UI prints:

```bash
npm run permission-agent -- <REUSABLE_WALLET> <PERMISSION_ID>
```

Run it multiple times up to the permission's max-use/max-spend limits. You can create additional permissions on the same wallet without affecting existing ones.

Stop `npm run demo` with Ctrl-C to stop both Vite and Anvil.

## Safe agent-to-agent payments (x402 + Intercepta)

Agents pay x402 services in USDC on Base Sepolia from a `ReusablePermissionWallet`. Every payment is screened live by
the [Intercepta API](https://intercepta.io) and the verdict — PAY, CAP, HOLD or REFUSE, with reasons — decides what happens.

- **Paying agent:** before signing, screens `payTo`, the token (real USDC vs lookalike) and the EIP-3009 authorization,
  then the wallet contract enforces budget/uses/expiry in `approvePayment` and accepts the signature via ERC-1271.
- **Paid service:** an x402 server with its own facilitator screens the payer wallet, its owner and its agent before
  verifying or settling.
- **Counterparty risk:** every wallet on the other side gets a profile (TRUSTED / CAUTION / BLOCKED) with Intercepta's reasons.

Payments run on Base Sepolia; screening uses the same addresses' **mainnet** history (Intercepta only covers mainnets).

### Where the Intercepta API is called

- [`packages/risk/src/intercepta.ts`](packages/risk/src/intercepta.ts) — the only HTTP client (quick scan, deep scan, summarize, token, message)
- [`apps/agent/src/x402/screen.ts`](apps/agent/src/x402/screen.ts) + [`guarded-signer.ts`](apps/agent/src/x402/guarded-signer.ts) — payer gate, runs before `approvePayment`/signing
- [`apps/service/src/payer-gate.ts`](apps/service/src/payer-gate.ts) — payee gate, runs before facilitator verify/settle
- [`packages/risk/src/policy.ts`](packages/risk/src/policy.ts) — how results become PAY / CAP / HOLD / REFUSE

### Run it

Prerequisites (manual, one-time):

- An Intercepta API key: free at [intercepta.io/ethglobal](https://intercepta.io/ethglobal)
- Risky test addresses to use as `RISKY_PAYTO`/`RISKY_OWNER`: pinned in Intercepta's ETHGlobal Discord
- Base Sepolia ETH on the owner, agent and facilitator keys (any Base Sepolia faucet)
- ~1.2 USDC on the owner key: [faucet.circle.com](https://faucet.circle.com)

Once you have an Intercepta key and a risky/clean address pair, sanity-check the API before wiring up the full demo:

```bash
npm --workspace @eaw/risk run smoke -- <riskyAddress> <cleanAddress>
```

See [`packages/risk/scripts/smoke.ts`](packages/risk/scripts/smoke.ts) — it's the first live call against Intercepta and prints the raw response shapes.

With `.env` filled in (see `.env.example`):

```bash
set -a; source .env; set +a                   # export .env so forge sees $RPC_URL / $OWNER_PRIVATE_KEY
cd packages/contracts && forge script script/DeployX402.s.sol:DeployX402 --rpc-url $RPC_URL --broadcast --private-key $OWNER_PRIVATE_KEY
# put FACTORY_ADDRESS in .env, then:
npm --workspace @eaw/agent run x402:setup      # put printed WALLET_ADDRESS / RISKY_WALLET_ADDRESS in .env
npm --workspace @eaw/service start &            # terminal 1
npm --workspace @eaw/agent run x402:demo
```

Expected output:

1. `verdict: PAY status: settled` with a basescan link.
2. `verdict: REFUSE status: refused` with Intercepta trait reasons (e.g. `sanction_address`).
3. `verdict: HOLD status: held` (`above_hold_threshold`), then 3b `PAY … settled` with `owner_approved`.
4. `verdict: PAY status: rejected_by_payee` with `payer_refused: owner 0x…: <trait descriptions>`.

If 1 fails at the facilitator with a signature error, confirm the signature is 96 bytes and `verifyTypedData` is the viem *public* action (ERC-1271 capable).

Then run the UI flow: `npm --workspace @eaw/agent run daemon`, `npm run web`, open the **x402 payments** tab, and repeat 1–4 with the buttons, approving the hold from the inbox.

Origins must match exactly (`localhost` and `127.0.0.1` are different origins): open the UI at the same origin as
`AGENT_UI_ORIGIN` (the daemon rejects other origins), and set `VITE_SERVICE_URL` to the same origin as `SERVICE_URL`.

### Known limitations

- The permission budget is consumed when the agent approves a payment on-chain, not when it settles.
- An approved-but-unsettled authorization survives a revoke until its `validBefore` (the agent refuses windows over 15 minutes).
- `createWalletFor` on the factory is permissionless — fine for the demo, not for production.

### Intercepta API feedback

- **Time to first call:** minutes once we had the key. A plain `X-API-KEY` header and clear OpenAPI pages made it easy; our 7-call smoke run (`packages/risk/scripts/smoke.ts`) takes about 9 s end to end.
- **Confusing:** Scan Message's documented `messageType` enum has no `TransferWithAuthorization` (EIP-3009, what x402 signs), yet the endpoint accepts it and returns a `riskGroup`. We only found that out by trying.
- **Confusing:** the trait `risk` scale isn't documented. Live responses show 0–100 with fractional values (e.g. `fake_phishing_transfer` at 0.54), so we had to guess thresholds.
- **Missing:** Scan Message rated a transfer *to a sanctioned address* as `Low`. It doesn't factor in the recipient's own risk, so we screen `payTo` separately with the address scans.
- **Missing:** no testnet chain ids. x402 runs on testnets, so we rewrite the EIP-712 domain to Base mainnet (chain 8453, mainnet USDC) purely for screening.

## Structure

- `SPEC.md` — source of truth for MVP behavior
- `packages/contracts` — mission wallet, factory, demo target, tests and deployment script
- `packages/shared` — shared TypeScript types
- `packages/risk` — Intercepta API client, wallet/counterparty profiling, PAY/CAP/HOLD/REFUSE policy (`@eaw/risk`)
- `apps/agent` — local agent executor; also the x402 pay loop, hold queue and daemon API (`src/x402/`)
- `apps/service` — x402-paid API with an Intercepta payer gate in front of its facilitator
- `apps/web` — mission creation UI, plus an x402 payments tab
- `scripts/demo.mjs` — local demo orchestrator

## Current scope

The MVP deliberately uses native ETH and a local Anvil chain for the disposable-wallet and reusable-permission models,
both of which are implemented. On top of that, `apps/agent` and `apps/service` add a live x402 payment flow in USDC on
Base Sepolia, screened end-to-end by Intercepta (see "Safe agent-to-agent payments" above). Real DeFi targets,
ERC-4337/session keys, and LLM planning come next.
