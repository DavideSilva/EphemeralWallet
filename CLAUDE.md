# EphemeralWallet

Hackathon MVP: give AI agents narrowly-scoped, disposable authority over funds, plus safe agent-to-agent x402 payments
screened by the Intercepta API. `README.md` is the user guide; `SPEC.md` is the source of truth for contract behaviour.

## Commands

- `npm install` — npm workspaces (`apps/*`, `packages/*`). `package-lock.json` is gitignored; if the web app crashes on
  React after a pull, `rm -rf node_modules package-lock.json && npm install`.
- `npm test` — vitest in `packages/risk`, `apps/agent`, `apps/service`, `apps/web`.
- `npm --workspace @eaw/web run build` (vite + `tsc`), `npm --workspace @eaw/agent run typecheck`.
- `cd packages/contracts && forge test` — the Base Sepolia fork test skips unless `BASE_SEPOLIA_RPC_URL` is set.
- `npm run demo` — card demo on a plain local Anvil chain (port 8545) + web UI on 5173.
- `npm run x402:local [-- --demo]` — x402 stack on an Anvil fork of Base Sepolia: service (4021), agent daemon (4100),
  web UI (`/payments`, and the card pages: it deploys `Deploy.s.sol` and sets `VITE_CHAIN_ID=84532` +
  `VITE_FROM_BLOCK`). Needs `INTERCEPTA_API_KEY` in `.env`. Stop it and check ports 8545/4021/4100/5173 are free.
- `npm --workspace @eaw/risk run smoke -- <risky> <clean>` — live Intercepta check; rewrites `packages/risk/test/fixtures/live.json`.

## Layout

- `packages/contracts` — Foundry. `ReusablePermissionWallet` is both the multi-use card and the x402 payer
  (`approvePayment` + ERC-1271). Keep `SPEC.md` in sync with any contract change.
- `packages/shared/src/abis.ts` — the ABIs for the web app, agent and service (`abi.ts` re-exports the x402 subset).
  Update it whenever a contract signature or the `permissions` tuple changes (currently 9 fields, `asset` last).
- `packages/risk` (`@eaw/risk`) — Intercepta client, counterparty profiles, the pure PAY/CAP/HOLD/REFUSE policy.
- `apps/agent` — card agent CLI (`src/cli.ts`, `src/planner.ts`) and the x402 agent (`src/x402/`: guarded signer, pay
  loop, hold queue, daemon).
- `apps/service` — x402 express server, in-process facilitator, payer gate (`onBeforeVerify`).
- `apps/web` — TanStack Router + wagmi + shadcn/ui; the x402 page is `src/routes/payments.tsx`. `server/screening.ts` is a
  Vite dev-server endpoint (`/api/screen/:address`, loopback only) that screens a card's merchant via `@eaw/risk` in the
  issue-card dialog; any failure reads as unverified, never trusted.
- `docs/superpowers/` — the original x402 design spec and implementation plan (historical).

## Rules that matter here

- `packages/risk/src/intercepta.ts` is the only code that calls Intercepta. Other code goes through `@eaw/risk`.
- Screening fails closed: any Intercepta timeout, non-2xx, unexpected body or unknown enum value must refuse
  (agent) or abort verify (service), never pass as clean.
- USDC only moves after a PAY/CAP verdict: the guarded signer calls `approvePayment` only after `decide()`.
- Intercepta only knows mainnets: payments run on Base Sepolia (84532), screening uses chain `8453` and mainnet USDC.
- Intercepta 404s Anvil's well-known dev addresses, so anything that gets screened (owner, agent, payee) must use a
  fresh key; `x402:local` generates them per run.
- The agent daemon is localhost-only and hardened (loopback `Host` only, writes need JSON plus the UI's exact `Origin`,
  `/pay` limited to the service origin, 64 KiB bodies). Handler lives in `apps/agent/src/x402/daemon-handler.ts` (tested);
  `daemon.ts` only wires it up. Keep it that way.
- The service's payer gate pre-verifies the payment signature before screening, so garbage payloads cost no
  Intercepta quota. Keep the pre-verify first.
- Never commit `.env` or print the Intercepta key.
