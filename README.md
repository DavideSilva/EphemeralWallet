# Ephemeral Agent Wallet

Hackathon MVP for disposable, task-scoped agent authority.

> Give an AI agent a temporary capability, not a permanent wallet.

A mission gives one agent one allowed target, one spend limit, one expiry, and one execution. After a successful action, the authority is permanently consumed.

## Run the demo locally

Requirements: Node.js/npm, Foundry (`anvil` + `forge`), and a browser wallet.

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

Open the UI. It will ask your browser wallet to switch/add the local Anvil network (chain ID 31337).

The default agent address in the UI is Anvil account #1. Create a mission with a budget of at least `0.001 ETH`. The UI waits for the transaction, extracts the new mission-wallet address from `MissionCreated`, and prints the command for the agent.

Run that command in a second terminal:

```bash
npm run agent -- <MISSION_WALLET>
```

The agent reads the constraints from the mission wallet, constructs a purchase of `coffee` from the allowed `DemoShop`, validates the target/budget/expiry locally, and executes it through Anvil's unlocked agent account.

Running the same command a second time should fail because the authority has already been consumed.

Stop `npm run demo` with Ctrl-C to stop both Vite and Anvil.

## Structure

- `SPEC.md` — source of truth for MVP behavior
- `packages/contracts` — mission wallet, factory, demo target, tests and deployment script
- `packages/shared` — shared TypeScript types
- `apps/agent` — local agent executor
- `apps/web` — mission creation UI
- `scripts/demo.mjs` — local demo orchestrator

## Current scope

The MVP deliberately uses native ETH and a local Anvil chain. ERC-20 support, real DeFi targets, ERC-4337/session keys, and LLM planning come after the core one-time-authority demo is solid.
