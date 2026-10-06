# Colosseum submission: drafts

Drafts for the Colosseum Crypto World's Fair submission (deadline 12 October 2026, 23:59 PT). Everything here is in
English, as the form wants it. Lines marked **OWNER** are for the owner to fill in or rewrite; numbers marked
**FILL** come from `/stats` and from the first users on mainnet (step 9).

## Name

Stakeward

## One line

A lock on your natively staked SOL that a stolen wallet cannot open: set on the stake accounts you already have, by the
Solana stake program itself, with no custody and no program of our own.

## Short description (under 50 words)

Stakeward puts the Solana stake program's built-in lockup on your existing stake accounts and makes a second wallet you
control its custodian. A thief with your main key cannot withdraw the stake or take it over. If the key is stolen, both
keys move the stake to a new wallet.

## Long description

**The problem.** A native stake account has two authorities: the staker, which delegates, and the withdrawer, which
withdraws and can hand both roles to anyone. Usually both are the user's main wallet key. Whoever gets that key, by a
phished seed phrase, malware or a transaction with a hidden `Authorize` instruction, owns the stake. This is not
hypothetical: on 8 September 2025, 192,600 SOL left SwissBorg through a withdraw-authority change that a compromised
staking API slipped into transactions (MPC did not help); on 31 January 2026, Step Finance lost 261,854 SOL; in
August 2026 Ledger owners were hit by seed-phrase phishing. **OWNER:** add the source link for each incident.

**The insight.** Every stake account carries a `Lockup { unix_timestamp, epoch, custodian }`. While it is in force, a
withdrawal and a change of the withdrawer also need the custodian's signature; deactivating, delegating, splitting and
changing the staker do not. The official docs say a lockup can only be set when the account is created. The stake
program's code says otherwise: the withdrawer can put a new lockup on an existing account whose lockup is not in force.
We proved it on LiteSVM, on devnet and on mainnet (the gate run in `docs/gate.md`, mainnet transaction
[5w6k…pt9W](https://explorer.solana.com/tx/5w6kvDNJMs83Hb33ZaWS6fo2oSFq1jvazZvCcFfdjAppa7a7nXUGGeUwS2PbxSd9A8NK7Jer14XcSvUGaWNCpt9W)),
together with every refusal the product relies on (`LockupInForce`, `CustodianMissing`, `MissingRequiredSignature`).

**The product.** Stakeward makes the custodian a second key the user controls: a second wallet from a different seed
phrase, ideally a second Ledger. The user picks stake accounts, a lock period (1 to 12 months) and the second key; both
keys sign one `SetLockupChecked` per account. From then on:

- a thief with only the main key cannot withdraw the stake, take the withdrawer role or touch the lock; the network
  itself refuses;
- monitoring watches every protected account and sends a Telegram alert within minutes of a deactivation, a delegation
  change, a split, an authority or lock change, a balance drop, and before the lock ends;
- Rescue moves every stake account to a new wallet with the main key, the second key and the new wallet signing one
  transaction per account, on a durable nonce so three signatures never race a blockhash, and it works even if the thief
  already changed the staker;
- if the second key may be stolen, it hands the lock to a new second key in one transaction, and the lock never opens;
- a printable recovery card and the README give the Solana CLI commands that do all of this without Stakeward.

**What makes it trustworthy.** Stakeward is non-custodial and deploys no on-chain program: every transaction holds
only stake program, nonce and compute budget instructions, in the exact format a Ledger shows in clear (no blind
signing). The browser builds every transaction; a transaction inspector reads back the exact bytes about to be signed
and shows what changes, who signs and what the transaction cannot do; after each wallet signs, the site checks that the
wallet changed nothing but an allowed tail. The backend never builds, holds or signs a transaction: if it is down or
hacked, users lose alerts, not money. Stakeward never asks for a seed phrase, has no accounts and no logins, and is
free. The code is open source (MIT).

**Honest limits.** Whoever holds the second key can freeze the stake (set any end date or hand the lock to any key), so
it must be guarded like the main key. Lose the second key and you wait until the lock ends. The second key is not a
backup of the main key. A thief with the main key can still deactivate, redelegate and split; Stakeward alerts and the
lock keeps the SOL in place. Out of scope: liquid staking tokens, exchange stake, validator vote accounts, plain SOL.

**What is built** (all in the public repository):

- `packages/core`: decoding, lock rules, transaction builders, the inspector, signature checks, snapshot diff for
  alerts, error translation. Every builder runs against the real stake program on LiteSVM in CI.
- `apps/web`: the site (React, Tailwind, shadcn/ui): accounts by address without a wallet, Protect, Withdraw, Extend,
  Rescue, co-signing by link on another device (`/cosign`, QR code), the recovery card, stats.
- `apps/worker`: one Cloudflare Worker: static site, an RPC proxy that only forwards transactions the inspector
  accepts, monitoring every 2 minutes on D1, the Telegram bot.
- Tests: **FILL** (`pnpm test` totals) unit and LiteSVM integration tests, worker tests in workerd with a local D1,
  Playwright on the built site under the production CSP at 1280 and 360 px with axe.

## Links

- Repository: https://github.com/Zhibul-Alexander/stakeward
- Live app: **OWNER** (the prod address after the mainnet check of step 9; today `stakeward-prod.zhibul-alexander.workers.dev`)
- Telegram bot: `@stakeward_bot`
- Mechanism proof: `docs/gate.md` (LiteSVM 24/24, devnet 21/21, mainnet 8/8 checks)
- Recovery without Stakeward: README, section "Recover without Stakeward", and `docs/recovery-cli.md`

## Logo

`docs/logo.png` (512 x 512, transparent) and the site icon `apps/web/public/favicon.svg`: a padlock on a shield in the
site's primary colour `#4338ca`. **OWNER:** replace if you have a better one; the favicon file is the source.

## Code written before 14 September 2026

None. The repository's first commit is from 1 October 2026; the whole product was written during the hackathon.

## Go-to-market and demand

**Who it is for.** (1) Holders of large native stake on a Ledger, who are not developers and fear losing it; (2)
validators and teams that keep treasury stake natively; (3) the person who holds someone's second key.

**First users.** Validators and Superteam Georgia (step 9). **OWNER:** names or handles of first users who protected a
mainnet stake account, and their quotes.

**Numbers** (from `/stats` on mainnet, **FILL** before submitting):

- stake accounts under a lock: **FILL**
- SOL under a lock: **FILL**
- alerts delivered: **FILL**
- people who protected stake (distinct main keys): **FILL** (from the worker's `accounts` table: `SELECT COUNT(DISTINCT withdrawer)`)

**Channels.** Validators' communities (they can point their delegators to it), Superteam chapters, Ledger-holder
communities, a short write-up of the lockup insight (the docs say it cannot be done on existing accounts; the program
says it can) with the mainnet transactions.

## Business

**OWNER: rewrite in your own words.** Draft from CLAUDE.md section 16:

The base stays free: protect, monitor with Telegram alerts, withdraw, rescue and the recovery card. Two paid tiers by
subscription in fiat (no token, no crypto payments):

- **Pro** for individuals: a phone call on a critical alert, more alert channels (email, SMS), alerts on the
  validator (commission changes, delinquency), and a periodic check that the second key still works.
- **Teams** for organisations: Slack and webhooks, many accounts and wallets, reports for auditors, a public
  attestation page ("this treasury stake is locked until..."), an API, roles.

The free tier is the funnel: every protected account is a user who already trusts the alerts. The cost base is small:
one Cloudflare Worker and one RPC plan.

## Pitch video script (2–3 minutes)

1. **0:00–0:20, the hook.** "On 8 September 2025, 192,600 staked SOL left SwissBorg in one transaction. The attacker
   did not need to break a vault: a compromised staking API slipped one extra instruction into transactions, and the
   withdraw authority changed hands. Whoever holds the key to a stake account owns it."
2. **0:20–0:50, the insight.** "Every Solana stake account has a lock built in: a lockup with a custodian. While it is
   in force, nobody can withdraw or change the owner without the custodian's signature. The docs say you can only set
   it when the account is created. We read the program: you can set it on the stake you already have. We proved it on
   mainnet."
3. **0:50–1:30, the product.** Show the app: check a stake by address, protect two accounts with a second key in about
   a minute, the signing screen that says what changes and that this transaction cannot move your SOL.
4. **1:30–2:10, why it is safe.** Non-custodial, no program of our own, every transaction readable on a Ledger, the
   backend never signs; if Stakeward disappears, the recovery card's CLI commands still work.
5. **2:10–2:40, traction and business.** **FILL** numbers from `/stats`, first users; free base, Pro and Teams later.
6. **2:40–3:00, close.** "Stakeward: a lock a stolen wallet cannot open."

## Product demo script (under 3 minutes): theft, refusal, alert, rescue

Prepared on mainnet with a small stake (step 9) or on devnet with 10-minute locks. Before recording: two protected
stake accounts on the main key, Telegram linked, a funded new wallet.

1. **0:00–0:25, protected.** `/app?address=<main key>`: both accounts read Protected until a date; the second-key list.
2. **0:25–0:55, the theft.** "Our main key has leaked." In a terminal with the main key file (the thief's view), run
   `solana withdraw-stake <stake> <thief address> ALL --withdraw-authority main.json --fee-payer main.json`. The network refuses:
   `lockup has not yet expired`. Then try `stake-authorize-checked` to make the thief the withdrawer: `custodian
   address not present`.
3. **0:55–1:20, what the thief can do.** The thief deactivates the stake (this works); within about two minutes the
   Telegram alert arrives: "Stake ... was deactivated. If this was not you, your main key may be stolen. Your SOL
   cannot be withdrawn without the second key." Tap Open Rescue.
4. **1:20–2:30, the rescue.** `/rescue` opens with the main key filled in. Connect the second key and the new wallet;
   the new wallet creates its nonce account; for each stake account the three keys approve; the page checks the chain:
   staker and withdrawer are now the new wallet, the lock and its end date unchanged.
5. **2:30–2:55, without us.** Open the recovery card: the same steps as Solana CLI commands, printable. "If Stakeward
   is gone tomorrow, your stake still answers only to your keys."
