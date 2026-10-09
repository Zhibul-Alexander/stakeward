---
name: qa-e2e
description: End-to-end QA of Stakeward with real transactions and headless wallets, on a local full stack (LiteSVM) or on the deployed dev environment (devnet). Use before a prod run, after a deploy to dev, or when asked to "test staking end to end", "run QA", "check dev".
---

# Stakeward end-to-end QA

Brings Stakeward up (or points at dev), connects headless wallets, and walks the product flows in a real browser on
desktop (1280 px) and mobile (360 px, touch, mobile user agent), with positive and negative scenarios. Every
scenario checks its result on the chain, not only on screen (CLAUDE.md section 12).

**Never run it against prod.** The suite refuses `stakeward-prod.stakeward.workers.dev`, its wallets claim
`solana:devnet` only (a mainnet build does not list them), and its RPC must report devnet's genesis hash.

## Two targets

| | `local` (default) | `dev` |
| --- | --- | --- |
| Site and API | built here, served by the real worker under `wrangler dev --local` | https://stakeward-dev.stakeward.workers.dev |
| Chain | LiteSVM with the committed mainnet stake program, behind a JSON-RPC server that stands in for devnet | devnet |
| Network needed | none (npm install only) | devnet RPC, workers.dev, faucet |
| Rate limits | raised (one IP at test speed) | the real per-IP limits; a 20 s pause before each scenario |
| Cost | nothing | about 0.1 devnet SOL per run (fees and stake-account rent left in throwaway accounts) |
| Extra controls | expire the blockhash, next epoch, RPC faults | none: scenarios that need them are skipped |

`local` is the fast, deterministic check of the code in this checkout. `dev` checks what is deployed, against the
real devnet, the real Helius proxy, rate limits and the monitor.

## Run it

From the repository root, after `CI=true pnpm install --frozen-lockfile`:

```bash
pnpm qa:local                 # build + local stack + all scenarios, desktop and mobile
pnpm qa:dev                   # the deployed dev site on devnet
pnpm qa:local --project=mobile protect        # Playwright filters: a project, a file, -g "title"
QA_NO_BUILD=1 pnpm qa:local   # reuse apps/web/dist (must be a devnet build)
```

Deploying the branch to dev first is the owner's call (`pnpm deploy:dev`, needs Cloudflare credentials); this skill
never deploys, and never to prod.

Browsers: Playwright's own Chromium (`pnpm --filter @stakeward/web exec playwright install chromium`), or set
`QA_CHROMIUM` to a preinstalled one. In a Claude Code cloud session: `QA_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
Cloud sessions reach devnet and workers.dev only if the environment's network policy allows
`api.devnet.solana.com`, `stakeward-dev.stakeward.workers.dev` and `faucet.solana.com`; `local` needs neither.

## Read the result

- `apps/web/.cache/qa-report/summary.md`: one line per scenario and viewport, then the first error line of each
  failure with its screenshot, video and trace paths. Read this first.
- `apps/web/.cache/qa-report/html/`: the Playwright report (`pnpm --filter @stakeward/web exec playwright show-report .cache/qa-report/html`).
- Each scenario attaches `api-usage` (calls per `/api/*` path and status: a `429` there means the rate limit hit)
  and `console` (browser errors and warnings).
- A failure's `error-context.md` (next to its screenshot) holds the page's accessibility tree at the moment it failed:
  usually enough to tell a product bug from a changed label.

Report to the owner in Russian (CLAUDE.md): passed / failed per scenario and viewport, for each failure what the
user would see and whether it is a product bug or a test that needs updating, with the screenshot path. A failure
is never fixed by weakening the scenario (CLAUDE.md section 15).

## What it covers

| Spec | Scenarios |
| --- | --- |
| `site.qa.ts` | security headers on `/` and `/api`; `/api/health` fresh; every route renders with no page error and no horizontal scroll; `/app` by address without a wallet (Not protected, axe clean); negatives: malformed address, address without stake, broken `/cosign` link |
| `protect.qa.ts` | F1: two accounts in one wallet request per key, lock and second key read back from the chain, `/app` shows them locked; negatives: second key declines then Try again, wallet tampers with the message (caught before sending), blockhash expires between signatures (local), main key offered as its own second key, seed-phrase box required |
| `withdraw-extend.qa.ts` | F3: withdraw with both keys, account closed and SOL back on the main key; negative: second key declines, nothing moves; delegated stake: stop staking, next epoch, withdraw (local). F5: second key alone extends and pays; remove the lock (confirmation box enforced), then the main key withdraws alone |
| `rescue.qa.ts` | F4: new wallet creates the link-signing (nonce) account, new wallet + main key + second key sign, staker = withdrawer = new wallet, lock unchanged, main key asked once and pays nothing |

Not covered (manual, docs/TESTPLAN.md): real wallet apps (Phantom's Lighthouse tail, Ledger display, Phantom's
in-app mobile browser), Telegram alerts, signing by link on a second device.

## How it works

- `apps/web/qa/support/wallet.ts`: `QaWallet` registers in the page as a real **Wallet Standard** wallet (the same
  discovery Phantom uses), with `standard:connect`, `standard:events` and `solana:signTransaction`. The key stays in
  Node: the page calls a Playwright binding, Node signs with kit's `partiallySignTransaction`. Behaviours for negative
  scenarios: `reject`, `rejectConnect`, `tamper`, `skipSignature`, `delayMs`, `beforeAnswer` (`wallet.once({...})`
  for the next signature only, `wallet.behaviour = {...}` for all).
- `apps/web/qa/support/chain.ts`: `QaChain` funds throwaway keys (local airdrop; on dev from `.keys/devnet-funder.json`,
  created and airdropped on first use, or `QA_FUNDER_KEY`), creates stake accounts with ordinary transactions,
  delegates, sets a lock directly (`qa.protect`, for scenarios that start from a protected account), reads accounts
  back, and sweeps leftover SOL back to the funder after each test on dev. `qa.control(...)` and `qa.warpEpoch()`
  exist on `local` only.
- `apps/web/qa/local/chain-server.ts`: JSON-RPC over LiteSVM (core's `TestChain` + `LiteSvmChain`), clock synced to
  the wall clock, plus `/qa/*` controls. `apps/web/qa/local/stack.ts` starts it, builds the site, applies the D1
  migrations to a fresh local database and runs the worker; state lives in `apps/web/.cache/qa-local/`.
- `apps/web/qa/support/fixtures.ts`: fixtures (`qa`, `wallets`, page-error collection that fails a test on an
  uncaught error or a CSP violation) and UI steps (`connect`, `sign`, `signAll`, which signs in whatever order the
  page asks and connects a key when the page asks for it).

## Adding a scenario

1. Find the flow's labels in the component tests (`apps/web/test/*.test.tsx`) or `src/i18n/en.json`; select by role
   and accessible name, as those tests do.
2. Create keys with `wallets.create(name, sol)` before `page.goto`; create accounts with `qa.createStake(main.signer)`.
3. End with a chain check (`qa.stake`, `lockOf`, `qa.balance`), not only a screen check.
4. Local-only steps: `requires('local-controls')`; delegated stake on dev: `requires('delegated')` (opt in with
   `QA_DELEGATED=1`, 1 SOL each, locked for days).
5. Run it on both projects locally before a dev run.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `QA_TARGET` | `local` | `local` or `dev` |
| `QA_BASE_URL` | per target | site under test (never prod) |
| `QA_RPC_URL` | local chain / `https://api.devnet.solana.com` | RPC the suite itself uses for setup and checks; a Helius devnet URL avoids public rate limits |
| `QA_FUNDER_KEY` | `.keys/devnet-funder.json` | dev: key that pays for test keys |
| `QA_COOLDOWN_MS` | `20000` | dev: pause before each scenario |
| `QA_DELEGATED` | unset | dev: `1` runs scenarios that need delegated stake |
| `QA_CHROMIUM` | unset | path of a Chromium to use instead of Playwright's |
| `QA_NO_BUILD` | unset | local: `1` skips the site build |
| `QA_CHAIN_PORT`, `QA_SITE_PORT` | `8899`, `8787` | local ports |
