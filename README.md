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

## Structure

- `SPEC.md`: source of truth for contract behavior
- `packages/contracts`: wallets, factories, demo merchants, tests and deployment script
- `packages/shared`: ABIs and revert decoding shared by the app and the agent
- `apps/agent`: agent CLI with the Claude and offline planners
- `apps/web`: React app (TanStack Router and Query, wagmi, shadcn/ui) for cards and activity
- `scripts/demo.mjs`: local demo orchestrator

## Current scope

The MVP deliberately uses native ETH and a local Anvil chain. ERC-20 support, real DeFi targets, and ERC-4337/session keys come next.
