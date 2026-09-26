# Ephemeral Agent Wallet

Hackathon MVP for disposable, task-scoped agent authority.

> Give an AI agent a temporary capability, not a permanent wallet.

The project demonstrates two models: **a disposable wallet per mission** for maximum isolation, and **a reusable wallet with multiple disposable permissions** for repeated agent activity.

On top of that, agents can **pay each other over x402** in USDC from a reusable wallet, with every payment screened live by the [Intercepta API](https://intercepta.io) before the agent signs it and before the service accepts it. See [Safe agent-to-agent payments](#safe-agent-to-agent-payments-x402--intercepta); the quickest way to try it is `npm run x402:local -- --demo`.

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
3. deploys `MissionFactory`, `ReusableWalletFactory` and three demo merchants (Café, Ticket office, Tip jar)
4. passes their addresses to the web app
5. starts the UI at `http://localhost:5173`

The UI signs as Anvil account #0 (no wallet popups) and issues cards to Anvil account #1 by default. Stop everything with Ctrl-C.

### Cards

A card lets one agent spend at one merchant, up to a budget, until it expires.

- **One-time card**: its own `EphemeralMissionWallet`, funded with the budget. One purchase, then it's used up; cancelling it refunds the balance.
- **Multi-use card**: a permission on your `ReusablePermissionWallet` account, which is opened the first time you issue one. The agent can buy until the budget or uses run out; cancelling revokes only that card.

### Give an agent a task

Each card's page shows the command to run in a second terminal:

```bash
npm run agent -- <card> "buy two cinema tickets for tonight"
```

`<card>` is the wallet address for a one-time card, or `<wallet>-<id>` for a multi-use card. The agent reads the merchant's on-chain catalog, plans the order, and sends it with the task as the on-chain `memo`.

Planning uses Claude (`claude-opus-5`) when Anthropic credentials are available, for example `ANTHROPIC_API_KEY` in a root `.env` (see `.env.example`). Otherwise, or with `AGENT_PLANNER=offline`, it matches the task against the catalog by keyword.

The agent isn't told its limits and sends over-limit orders anyway, so the card is the one that says no. Rejected attempts are mined as reverts and show up in the app's activity as **Blocked**, with the reason.

## Safe agent-to-agent payments (x402 + Intercepta)

Agents pay x402 services in USDC on Base Sepolia from a `ReusablePermissionWallet`. Every payment is screened live by
the [Intercepta API](https://intercepta.io) and the verdict — PAY, CAP, HOLD or REFUSE, with reasons — decides what happens.

- **Paying agent:** before signing, screens `payTo`, the token (real USDC vs lookalike) and the EIP-3009 authorization,
  then the wallet contract enforces budget/uses/expiry in `approvePayment` and accepts the signature via ERC-1271.
- **Paid service:** an x402 server with its own facilitator screens the payer wallet, its owner and its agent before
  verifying or settling.
- **Counterparty risk:** every wallet on the other side gets a profile (TRUSTED / CAUTION / BLOCKED) with Intercepta's reasons.

Payments run against Base Sepolia's real USDC contract, either on a local Anvil fork (`npm run x402:local`) or on the public testnet. Screening uses the same addresses' **mainnet** history (Intercepta only covers mainnets). Contract behaviour is specified in [`SPEC.md`](SPEC.md#mode-b--token-permissions-x402).

### Where the Intercepta API is called

- [`packages/risk/src/intercepta.ts`](packages/risk/src/intercepta.ts) — the only HTTP client (quick scan, deep scan, summarize, token, message)
- [`apps/agent/src/x402/screen.ts`](apps/agent/src/x402/screen.ts) + [`guarded-signer.ts`](apps/agent/src/x402/guarded-signer.ts) — payer gate, runs before `approvePayment`/signing
- [`apps/service/src/payer-gate.ts`](apps/service/src/payer-gate.ts) — payee gate, runs before facilitator verify/settle
- [`packages/risk/src/policy.ts`](packages/risk/src/policy.ts) — how results become PAY / CAP / HOLD / REFUSE

### Run it locally (Anvil fork of Base Sepolia)

The quickest way to see it work. You only need Foundry and `INTERCEPTA_API_KEY` in `.env`:

```bash
npm install
npm run x402:local            # fork, deploy, fund, start service + agent daemon + UI
npm run x402:local -- --demo  # same, plus the scripted four-scenario demo
```

The launcher forks Base Sepolia into a local Anvil chain, so it's the real USDC contract (FiatToken v2.2) on chain id 84532. It deploys the demo contracts (the wallet factory plus the card contracts, so the card pages work too), creates fresh throwaway owner/agent/facilitator/payee keys, funds them on the fork (ETH plus USDC via `anvil_dealERC20`), creates the two demo wallets, and starts the x402 service, the agent daemon and the UI at http://localhost:5173 (open http://localhost:5173/payments). Screening still calls Intercepta live against mainnet data. `RISKY_PAYTO`/`RISKY_OWNER` come from `.env`. If they're unset, the launcher uses two addresses that Intercepta tiers BLOCKED for different reasons: the risky seller is `0x3930…2fed`, an Intercepta test address flagged as a known scammer that received funds from exploits and drainers; the risky wallet's owner is `0x098B…2f96`, the OFAC-sanctioned Ronin bridge exploiter. Settlement tx links point at basescan, but local fork transactions only exist on your Anvil chain.

The keys are fresh on every run because Intercepta rejects Anvil's well-known dev addresses with a 404 ("An Externally Owned Account with this address doesn't exist"). The fail-closed rule would otherwise refuse every payment.

### Run it on Base Sepolia

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

Then run the UI flow: `npm --workspace @eaw/agent run daemon`, `npm run web`, open http://localhost:5173/payments (the **Payments** page), and repeat 1–4 with the buttons, approving the hold from the inbox.

Origins must match exactly (`localhost` and `127.0.0.1` are different origins): open the UI at the same origin as
`AGENT_UI_ORIGIN` (the daemon rejects POSTs from any other origin, or with no `Origin` at all, and any `Host` other
than `localhost`/`127.0.0.1` on its port), and set `VITE_SERVICE_URL` to the same origin as `SERVICE_URL`. The service
only allows cross-origin reads from `SERVICE_UI_ORIGIN` (defaults to `AGENT_UI_ORIGIN`).

### Known limitations

- The permission budget is consumed when the agent approves a payment on-chain, not when it settles.
- An approved-but-unsettled authorization survives a revoke until its `validBefore` (the agent refuses windows over 15 minutes).
- `createWalletFor` on the factory is permissionless — fine for the demo, not for production. It emits
  `WalletCreatedFor` (with the creator), not `WalletCreated`, so it can't pass for the owner's own wallet.
- A payment that was approved on-chain but not confirmed as settled shows as **Not confirmed** (`unsettled`): the budget
  is spent and the seller can still settle it until `validBefore`.
- The service screens the paying wallet reliably, but the owner and agent it screens are whatever the wallet contract
  reports about itself; a hostile contract wallet can report clean ones.
- Screening fails closed: an Intercepta timeout, error or unexpected response refuses the payment. Intercepta also
  answers 404 ("An Externally Owned Account with this address doesn't exist") for some addresses, such as Anvil's
  well-known dev accounts, so those counterparties are refused too.
- `npm run x402:local` also deploys the card contracts on the fork, so the card pages and `npm run agent` work there
  too (chain 84532). The web app reads events only from the block after the fork point (`VITE_FROM_BLOCK`): earlier
  blocks would be fetched from the public Base Sepolia RPC.

### Intercepta API feedback

- **Time to first call:** minutes once we had the key. A plain `X-API-KEY` header and clear OpenAPI pages made it easy; our 7-call smoke run (`packages/risk/scripts/smoke.ts`) takes about 9 s end to end.
- **Confusing:** Scan Message's documented `messageType` enum has no `TransferWithAuthorization` (EIP-3009, what x402 signs), yet the endpoint accepts it and returns a `riskGroup`. We only found that out by trying.
- **Confusing:** the trait `risk` scale isn't documented. Live responses show 0–100 with fractional values (e.g. `fake_phishing_transfer` at 0.54), so we had to guess thresholds.
- **Missing:** Scan Message rated a transfer *to a sanctioned address* as `Low`. It doesn't factor in the recipient's own risk, so we screen `payTo` separately with the address scans.
- **Missing:** no testnet chain ids. x402 runs on testnets, so we rewrite the EIP-712 domain to Base mainnet (chain 8453, mainnet USDC) purely for screening.

## Development and tests

```bash
npm install
npm test                                   # vitest in packages/risk, apps/agent, apps/service
npm --workspace @eaw/web run build         # vite build + type-check
npm --workspace @eaw/agent run typecheck
cd packages/contracts && forge test        # contract tests; the Base Sepolia fork test is skipped...
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org forge test --match-contract X402ForkTest   # ...unless this is set
```

CI (`.github/workflows`) runs the same: `npm test`, the web build, the agent type-check and `forge test`.

If the web app crashes on start after pulling (for example a React version error), an old untracked
`package-lock.json` is likely pinning stale dependencies: `rm -rf node_modules package-lock.json && npm install`.

## Mount Fuji weather over x402

A mock web service that sells a Mount Fuji weather report behind [x402](https://x402.org). Set `WEATHER_PAY_TO` in `.env` to the address that receives payments, then:

```bash
npm run weather
curl -i http://localhost:4022/weather/mount-fuji   # 402 Payment Required
```

It runs on the public testnet with no screening or wallet contracts: each report costs $0.01 in USDC on Base Sepolia, settled through the public facilitator at `https://x402.org/facilitator`. To make a paid request, use any x402 client (for example [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch)) with a wallet holding Base Sepolia USDC from the [Circle faucet](https://faucet.circle.com). The report is random mock data. `WEATHER_PORT` changes the port.

## Structure

- `SPEC.md`: source of truth for contract behavior
- `packages/contracts`: wallets, factories, demo merchants, tests and deployment scripts (`Deploy.s.sol`, `DeployX402.s.sol`)
- `packages/shared`: ABIs and revert decoding shared by the app and the agent
- `packages/risk`: Intercepta API client, wallet/counterparty profiling, PAY/CAP/HOLD/REFUSE policy (`@eaw/risk`)
- `apps/agent`: agent CLI with the Claude and offline planners; also the x402 pay loop, hold queue and daemon API (`src/x402/`)
- `apps/service`: x402-paid API with an Intercepta payer gate in front of its facilitator
- `apps/weather`: mock x402 service selling Mount Fuji weather reports
- `apps/web`: React app (TanStack Router and Query, wagmi, shadcn/ui) for cards and activity, plus the x402 payments page (`/payments`)
- `scripts/demo.mjs`: local demo orchestrator; `scripts/x402-local.mjs`: x402 demo on an Anvil fork of Base Sepolia

## Current scope

The MVP deliberately uses native ETH and a local Anvil chain for the one-time and multi-use cards. On top of that,
`apps/agent` and `apps/service` add a live x402 payment flow in USDC on Base Sepolia, screened end-to-end by Intercepta
(see "Safe agent-to-agent payments" above). Real DeFi targets and ERC-4337/session keys come next.
