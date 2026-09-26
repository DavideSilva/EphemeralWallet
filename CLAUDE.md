# EphemeralWallet

Hackathon MVP: give AI agents narrowly-scoped, disposable authority over funds, plus safe agent-to-agent x402 payments
screened by the Intercepta API. `README.md` is the user guide; `SPEC.md` is the source of truth for contract behaviour.

## Commands

- `npm install` — npm workspaces (`apps/*`, `packages/*`). `package-lock.json` is committed; after changing a workspace's
  dependency versions, reinstall them with `npm install --workspace <ws> <pkg>@<ver>` so the lockfile keeps no stale
  nested copies (a second `@x402/core` breaks the weather typecheck).
- `npm test` — vitest in `packages/risk`, `apps/agent`, `apps/service`, `apps/web`.
- `npm --workspace @eaw/web run build` (vite + `tsc`), `npm --workspace @eaw/agent run typecheck`.
- `cd packages/contracts && forge test` — the Base Sepolia fork test skips unless `BASE_SEPOLIA_RPC_URL` is set.
- `npm run demo [-- --scenarios]` — the whole demo on an Anvil fork of Base Sepolia (port 8545): card contracts
  (`Deploy.s.sol`), x402 service (4021), Mount Fuji weather x402 seller (4022), agent daemon (4100), web UI on 5173 (cards + `/payments`, with
  `VITE_CHAIN_ID=84532` + `VITE_FROM_BLOCK`). `--scenarios` also runs the scripted x402 demo. Needs network access to
  fork. Without `INTERCEPTA_API_KEY` it still starts and screening fails closed (the client throws
  `ScreeningUnavailable` without calling out). Stop it and check ports 8545/4021/4022/4100/5173 are free.
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
- `apps/weather` — second x402 seller (Mount Fuji report, no payer screening). In-process facilitator when
  `WEATHER_FACILITATOR_PRIVATE_KEY` is set (the demo does), else the public x402.org facilitator. It's also a card
  merchant: the web app lists it from `VITE_WEATHER_PAY_TO` (a USDC permission, `asset` set), and `npm run agent` pays
  USDC cards through `apps/agent/src/x402-card.ts` (the same screened `payFromWallet` loop as the daemon).
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
  fresh key; `npm run demo` generates them per run.
- The agent daemon is localhost-only and hardened (loopback `Host` only, writes need JSON plus the UI's exact `Origin`,
  `/pay` limited to the service origin, 64 KiB bodies). Handler lives in `apps/agent/src/x402/daemon-handler.ts` (tested);
  `daemon.ts` only wires it up. Keep it that way.
- The service's payer gate pre-verifies the payment signature before screening, so garbage payloads cost no
  Intercepta quota. Keep the pre-verify first.
- Never commit `.env` or print the Intercepta key.
