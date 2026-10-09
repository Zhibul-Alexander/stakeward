# Stakeward: Colosseum submission drafts

Colosseum Crypto World's Fair. Deadline: 12 October 2026, 23:59 PT (13 October, 10:59 Tbilisi).
Drafts as of 8 October 2026, matching the code on `main` (steps 0-8 built). Every number below comes
from the code or from docs/gate.md; the fact sheet at the end says where. Text in `[TODO owner: ...]` is for the
owner to fill in.

## Before submitting (owner)

- [x] The repository https://github.com/Zhibul-Alexander/stakeward is public (it was private during the build; public as checked on 6 October 2026). Keep it public: the prod deploy reads the CI status without a token.
- [ ] Prod runs the current build and has passed the mainnet checks of step 9. Then replace `<PROD_URL>` below
      (D84: the prod address is not published before that).
- [ ] The numbers from `/stats` and the first users' quotes are filled in (section 8).
- [ ] The business section is written (section 9). TODO: the business model is not decided yet; the idea is in
      [BUSINESS-MODEL.md](BUSINESS-MODEL.md).
- [ ] Every incident below has a source link (section 11): links found and opened on 6 October 2026; the owner opens
      and checks each one before recording.
- [ ] The wallet table on the landing page shows the wallet matrix results, and section 4 says the same.
- [ ] Pitch video (2-3 min) and product demo (under 3 min) are recorded from the scripts in sections 6 and 7.
- [ ] Logo uploaded: `docs/brand/logo-512.png` (PNG) or `docs/brand/logo.svg`.
- [ ] Wording: Stakeward is a lock on stake accounts, not a wallet and not two-factor authentication. Say "second
      key", never "backup key" or "guardian".

## 1. Name

Stakeward

## 2. Links

| What | Link |
| --- | --- |
| Repository (MIT) | https://github.com/Zhibul-Alexander/stakeward |
| Product, Solana mainnet | `<PROD_URL>` [TODO owner: after step 9] |
| Test version, Solana devnet | https://stakeward-dev.stakeward.workers.dev |
| Telegram alerts bot | `@stakeward_bot` (mainnet), `@stakeward_dev_bot` (devnet) |
| Proof of the mechanism on mainnet | [docs/gate.md](gate.md), section Mainnet: 8 of 8 checks |
| Recovery without Stakeward | [README, "Recover without Stakeward"](../README.md#recover-without-stakeward) |

Three mainnet transactions from docs/gate.md that show the whole idea (5 October 2026):

- A lockup set on an existing stake account, signed by the main key and the second key:
  https://explorer.solana.com/tx/5w6kvDNJMs83Hb33ZaWS6fo2oSFq1jvazZvCcFfdjAppa7a7nXUGGeUwS2PbxSd9A8NK7Jer14XcSvUGaWNCpt9W
- The main key alone tries to withdraw: refused with `LockupInForce`:
  https://explorer.solana.com/tx/AntzPaGpqwGtJ2cuBDwkUyG8Rqi4UwusuRJbrQA3v7qWwmS66hez8SMHuC5Zy1EE9tq64H54EVVsp3bthETjLVw
- The main key and a thief's key try to change the withdraw authority: refused with `CustodianMissing`:
  https://explorer.solana.com/tx/5Qxos9NKwaPu8Ci9eZpjktgfKN31Exktjn9rGmj4UbDiubBTfCoGb3yhDCy71noKoB8wqkviks8A4Lyqja1zLUZo

## 3. Descriptions

### One line

Pick one:

- A lock for natively staked SOL: a stolen wallet key can no longer withdraw your stake.
- Lock your natively staked SOL with a second key you control, so a stolen wallet key cannot withdraw it.
  (the site's own tagline)

### Short (about 70 words)

Stakeward puts the lock built into the Solana stake program on stake accounts you already have, and makes a second
wallet of yours its key. While the lock holds, a thief with your main key cannot withdraw the stake or make it
theirs: the network refuses. You get Telegram alerts, and you can move the stake to a new wallet. Free,
non-custodial, open source, no program of its own.

### Long

**The problem.** A native stake account on Solana answers to one key, the withdraw authority. Usually that is the
key of the wallet you staked from. Whoever gets it can withdraw the stake, or quietly hand the withdraw authority to
themselves. Keys leak through phished seed phrases, malware and fake sites, and one hidden instruction in a
transaction you approve is enough. Public reports describe exactly this. In September 2025 SwissBorg lost about
192,600 staked SOL: a hacked staking partner hid a change of the withdraw authority inside a routine unstake
transaction, and SwissBorg's own signers approved it. On 31 January 2026, 261,854 staked SOL were unstaked and taken
from Step Finance's treasury after its executives' devices were compromised.

**The insight.** Every stake account already carries a lock: the lockup, with an end date and a custodian. While
the lockup is in force, the stake program requires the custodian's signature to withdraw and to change the withdraw
authority. The official documentation says a lockup is set only when the account is created. The program's code
(`Meta::set_lockup`) lets the withdrawer set a new lockup on an existing account whenever none is in force; after
that, only the custodian can change it. We checked this and every rule Stakeward relies on against the stake
program v5.1.0 on LiteSVM, devnet and mainnet (docs/gate.md).

**What Stakeward does.** It makes a second wallet of yours, from a different seed phrase, the custodian of the
lockup on your existing stake accounts, for 1, 3, 6 or 12 months. Your stake keeps earning with its validator.

- **Protect.** Check any wallet's stake by its address, without connecting anything. Then your main key and your
  second key sign one `SetLockupChecked` per stake account. The joint signature on the network is the proof that
  the second key exists and is yours.
- **Alerts.** A Cloudflare Worker reads the watched stake accounts every two minutes and sends a Telegram message
  when one is deactivated, redelegated, split, drained or closed, when its keys or its lock change, and 30, 14, 7, 3
  and 1 days before the lock ends.
- **Rescue.** A stolen key is a copy: the owner still has it. So the main key, the second key and a new wallet
  sign together, and both authorities of each stake account move to the new wallet. This works even if the thief
  already changed who manages staking. The rescue always runs on a durable nonce owned by the new wallet, so three
  signatures do not race a one-minute blockhash, and the stolen key never pays a fee.
- **Withdraw, extend, remove.** Both keys withdraw together. The second key alone extends the lock or removes it
  early.
- **Sign by link.** The second key can sign on another device: the partly signed transaction travels in the
  address fragment of a `/cosign` link or a QR code and never reaches the server.
- **Recovery card.** A printable card for each pair of main key and second key: what to do if a key is lost or
  stolen, with Solana CLI commands that work without Stakeward. No secrets on it.

**What a thief with only the main key can and cannot do.** While the lock holds, they can stop the staking,
redelegate, split the account and change the stake authority. They cannot withdraw a single lamport, take the
withdraw authority or touch the lock. Stakeward says this on the landing page in plain words.

**Trust model.** Stakeward never holds funds or keys and never asks for a seed phrase. It has no on-chain program
and no token. The browser builds every transaction from a TypeScript core, the user's own wallets sign, and the
result is checked on the network. Transactions contain only Stake program instructions for one stake account each,
System instructions for the durable nonce, and Compute Budget. No address lookup tables. A transaction inspector
decodes the exact bytes before every signature: the signing screen shows its summary, `/cosign` trusts only the
bytes and the network, and the worker's RPC proxy sends only transactions the inspector accepts, with every
signature verified. If the Stakeward server is down, users lose alerts, not SOL: the lock lives in the stake
program. The same server delivers the website, so a hacked server is a hacked website that could ask for a harmful
signature; the lock still needs the second key, and the site tells users to check the addresses their wallet or
Ledger shows.

**Honest limits.** Whoever holds the second key cannot move the SOL but can keep it locked, for years if they want.
If you lose the second key, you wait until the lock ends. Two keys from one seed phrase protect nothing. A thief
with the main key can split the stake into many small accounts; each keeps the lock, but one rescue run moves at most
10, so act early and extend the lock first. Stakeward does not cover liquid staking tokens, exchange stake, SOL in a
wallet balance or vote accounts.

**Wallets.** Stakeward talks to browser wallets through the Wallet Standard (Phantom, Solflare, Backpack, and a
Ledger through them). Tested so far: two Phantom accounts from different seed phrases, both in one browser, on
devnet on 8 October 2026: 4 of 4 co-signing runs (recent blockhash and durable nonce, either key first) landed
unchanged. Phantom warns that these transactions "could steal your funds in the future", as it does for any
transaction that gives a key a role in an account; the signing screen explains this before the wallet asks.
Solflare, Backpack and Ledger have not been tested yet, and the site marks untested pairs "Not verified yet". In a
phone wallet's own browser you can check stake, extend or remove a lock and co-sign by link; protecting and rescuing
need a computer. [TODO owner: signing by link from a phone after TESTPLAN stage 4.]

**How it is built.** pnpm monorepo in TypeScript. `packages/core` (pure, no I/O): decoding, lock rules, transaction
builders, inspector, signature checks, monitoring diffs, built on `@solana/kit` 8.4 and `@solana-program/stake`
0.10. `apps/web`: React 19, Vite, Tailwind CSS 4, shadcn/ui, Wallet Standard directly. `apps/worker`: one Cloudflare
Worker with Hono, D1 and a Cron Trigger, serving the site, the API and the Telegram webhook. Strict CSP, no
third-party scripts, fonts or analytics. Ledger: transactions use the account layout the Ledger Solana app parses
into readable fields; not yet tried on a device. About 2,300 automated tests (core 790, web 786, worker 598,
scripts 130 on 6 October 2026), including every transaction kind executed against the mainnet stake program in
LiteSVM, plus Playwright with axe on every route at 1280 and 360 px.

**Status.** [TODO owner: live on mainnet since `<date>`; N stake accounts and X SOL under lock; first users.]

## 4. Logo

- `docs/brand/logo.svg`: the mark, vector, transparent background. `docs/brand/logo-512.png`: the same mark at
  512 x 512 px for upload forms.
- `apps/web/public/favicon.svg`: the same geometry, used as the site's icon.
- The mark is a shield split into two halves with a keyhole: one lock that answers to two keys. Original artwork,
  no third-party assets.
- Colours are the site's tokens from `apps/web/src/styles/tokens.css`: primary `#4338ca` (left half), primary-hover
  `#3730a3` (right half), on-primary `#ffffff` (keyhole).

## 5. Style for every text

Plain words, short sentences. Roles are always Main key, Second key and New wallet; the stake program's names
(withdrawer, custodian, staker) only in technical answers. Every risk comes with its date or condition. No claim
beyond what docs/gate.md and the tests show: say "not tested yet" where that is true (Ledger, Solflare, Backpack).

## 6. Pitch video script (target 2:30)

About 310 words of voice-over. Screen recordings come from the devnet site and docs/gate.md; the incident slide
names its sources on screen.

| Time | On screen | Voice-over |
| --- | --- | --- |
| 0:00-0:20 | Black slide, two lines appear: "8 Sep 2025: about 192,600 SOL, SwissBorg" and "31 Jan 2026: 261,854 SOL, Step Finance". Sources in small type: Kiln post-mortem, The Block (section 11). | On the 8th of September 2025, SwissBorg lost about 192,600 staked SOL. A hacked staking partner had slipped hidden instructions into a routine unstaking transaction: they handed the stake accounts' withdraw key to the attacker, and SwissBorg's own signers approved it. In January 2026, Step Finance lost 261,854 staked SOL after attackers got into its executives' devices. |
| 0:20-0:40 | Diagram: a stake account with one key; the key copied by a hooded figure; arrow out. | Native stake on Solana answers to one key. Whoever gets it, through a phished seed phrase, malware, or a hidden step in a transaction you approved, can withdraw your stake, or make it theirs. |
| 0:40-1:05 | The same diagram, a padlock appears on the account with a second key. Then the stake program source, `Meta::set_lockup`, highlighted. | But every stake account has a lock built in: the lockup. While it holds, withdrawing, or changing who can withdraw, also needs the lock's own key. The docs say you can only set it when the account is created. The stake program's code says otherwise, and we proved it on mainnet. |
| 1:05-1:35 | Devnet site: landing, accounts page "Not protected", the protect wizard, "Review and sign", Done. | Stakeward turns that lock on for the stake you already have, with a second key you control, from a different seed phrase. Your stake keeps earning. A thief with your main key cannot withdraw it and cannot hand it to themselves. The network itself refuses. |
| 1:35-1:55 | Terminal: `Error: lockup has not yet expired`. Phone: Telegram alert "was deactivated". Rescue screen "2 stake accounts are safe". | Stakeward watches your stake every two minutes and messages you in Telegram if anything changes. If your main key is stolen, your main key, your second key and a new wallet sign together, and the stake moves out of the thief's reach. |
| 1:55-2:15 | Signing screen close-up: "This transaction cannot move your SOL", "Stakeward never asks for your seed phrase". Then the recovery card. | Stakeward never holds your SOL or your keys. It has no program and no token. Your browser builds every transaction, your wallets sign it, and you see what those exact bytes do before you approve. If Stakeward disappears, the lock keeps working, and your printed recovery card has the command-line steps. |
| 2:15-2:25 | Landing section "Your second key: read this first". | One honest limit: whoever holds your second key can keep your stake locked. Guard it like your main key. |
| 2:25-2:35 | `/stats` page, then the logo and the repository URL. | Stakeward is free and open source. [TODO owner: "Since launch, N stake accounts and X SOL are under lock."] Stakeward: a lock on your staked SOL, enforced by Solana itself. |

## 7. Product demo script (devnet, under 3:00)

The story: protect, key theft, the network refuses the thief, the alert, the rescue. Everything runs on the devnet
site with devnet SOL. In the voice-over, call it devnet once at the start.

### Before recording

1. Three Phantom accounts, each from its own new seed phrase, created only for this demo: **Main key**, **Second
   key**, **New wallet**. (Phantom is the wallet tested so far. If another wallet passes the matrix before
   recording, put the New wallet there: fewer account switches.)
2. Fund on devnet: Main key 0.05 SOL, New wallet 0.02 SOL (the rescue asks for at least its fees and the
   link-signing deposit and suggests 0.01 SOL). The Second key needs none.
3. `pnpm dev-accounts <MAIN_KEY_ADDRESS>` creates a delegated (1 SOL) and an undelegated (0.1 SOL) stake account,
   both without a lock. The devnet funder key pays about 1.104 SOL (D43). Use the delegated one as `<STAKE>` below.
4. The thief's terminal (Solana CLI 4.3.0, devnet):
   - `solana-keygen recover 'prompt://?key=0/0' --outfile stolen-main.json` with the Main key's demo seed phrase,
     then check that `solana-keygen pubkey stolen-main.json` prints the Main key's address. This plays the stolen
     key. Only ever with a throwaway demo wallet.
   - `solana-keygen new --no-bip39-passphrase --outfile thief.json`, fund it with 0.05 devnet SOL.
5. Telegram: open `@stakeward_dev_bot` with `/start <MAIN_KEY_ADDRESS>` on the phone; also have Telegram Desktop
   open on the recording computer.
6. Rehearse once end to end. Expected CLI output is below; if a line differs, film the failed transaction in
   Solana Explorer instead (docs/gate.md has the same failures on devnet).
7. Browser at 1280 px, light theme, zoom 110%. Close other tabs and wallet pop-ups.

### Script

| Time | On screen | Voice-over |
| --- | --- | --- |
| 0:00-0:10 | Landing page with the "Solana devnet" note. | This is Stakeward on devnet. I have stake, and I am about to have my main key stolen. |
| 0:10-0:25 | Paste the Main key address in "Check your stake". `/app` lists two stake accounts, both "Not protected"; "Last checked ... ago" at the top. | First, look. No wallet connected, nothing to sign: two stake accounts, not protected. |
| 0:25-0:40 | Press Protect. Step "Accounts": connect the Main key, both accounts ticked. Step "Second key": connect the Second key; the page warns that both keys are accounts of one wallet app; tick "My second key comes from a different seed phrase". | I connect my main key, then my second key. Both sit in Phantom here, but I imported the second key from its own seed phrase, and the page reminds me to check exactly that. |
| 0:40-0:50 | Step "Lock period": choose "1 hour (devnet test)". The risk note with the end date. | On devnet I lock for an hour. On mainnet it is 1 to 12 months, and the risk is spelled out before I sign. |
| 0:50-1:05 | "Review and sign": both stake accounts in full, who signs, the network fee, "This transaction cannot move your SOL", "Stakeward never asks for your seed phrase". Sign as Main key in Phantom, switch account, sign as Second key. | Both keys sign. The summary is read from the exact bytes my wallet receives. |
| 1:05-1:15 | "Sending", "Waiting for the network to confirm", then Done: "2 stake accounts are protected", the lock's end date next to the Telegram button, recovery card. | Done, checked on the network. With Telegram on, I get an alert on any change and a reminder before the lock ends. |
| 1:15-1:25 | Terminal, title "The thief has my main key". `solana deactivate-stake <STAKE> --stake-authority stolen-main.json --fee-payer thief.json --url devnet` succeeds. | Now a thief has my main key. They can stop my staking. That works. |
| 1:25-1:35 | `solana withdraw-stake <STAKE> <THIEF_ADDRESS> ALL --withdraw-authority stolen-main.json --fee-payer thief.json --url devnet` prints `Error: lockup has not yet expired`. | But withdrawing? The Solana network refuses: the lock needs my second key. |
| 1:35-1:45 | `solana stake-authorize-checked <STAKE> --withdraw-authority stolen-main.json --new-withdraw-authority thief.json --fee-payer thief.json --url devnet` prints `Error: custodian address not present`. | The hidden trick from the SwissBorg case, handing the stake to themselves, is refused too. |
| 1:45-2:00 | Cut ("2 minutes later"). Phone: the bot's message "Stake <short address> was deactivated. If this was not you, your main key may be stolen. Your SOL cannot be withdrawn without the second key." with the button "Open Rescue". | Two minutes later my phone tells me. |
| 2:00-2:10 | Telegram Desktop: press "Open Rescue". `/rescue` opens with the Main key filled in; "Find its stake" shows "Your stake is locked until ...". | One tap opens the rescue with my main key filled in. |
| 2:10-2:20 | Step "New wallet": connect the New wallet, tick "My new wallet comes from a new seed phrase that no one else has seen", balance check passes. Step "Keys": the Second key co-signs here. | I connect a new wallet from a new seed phrase. It pays the fees, so the stolen key never has to. |
| 2:20-2:35 | Step "Move": "New owner of your stake" with the full address, and the warning (already shown on the New wallet and Keys steps) that the new wallet shares Phantom with the main key and the second key. "Create the link-signing account", then each stake account signed by the New wallet, the Main key and the Second key (montage at 4x, Phantom account switches visible). | Three keys sign: my old main key, which I still have, my second key and the new wallet. Each transaction runs on a durable nonce, so nothing expires while I switch wallets. |
| 2:35-2:45 | Done: "2 stake accounts are safe", "Now controlled by your new wallet", "Earn rewards again". | My stake now belongs to the new wallet, still locked. The thief's key controls nothing. |
| 2:45-2:55 | Solana Explorer on one stake account: stake and withdraw authority = New wallet, lockup custodian = Second key. End card: logo, repository URL, "Free. Non-custodial. No program, no token." | Verified on chain. Stakeward: free, open source, and it never touches your SOL. |

### Optional inserts (only if the cut stays under 3:00)

- 5 s, in the protect step: reject once in the Second key's wallet. The page says "Nothing was sent" and offers
  "Try again". Voice-over: "If something fails, nothing is sent, and you can try again."
- 5 s, after the rescue: the bot's next message "The main key of stake ... changed to ...". Voice-over: "The
  alerts follow the stake to the new wallet."
- 5 s, end: the recovery card in print preview. Voice-over: "If Stakeward goes down, the lock keeps working, and
  this card has the commands."

## 8. Go-to-market and demand evidence

### Who it is for

1. **Holders of large native stake**, often on a Ledger, who are not developers and fear losing it. They start
   with zero risk: paste an address and see which stake is protected. No wallet connection.
2. **Validators and teams** with treasury stake. Many stake accounts, one transaction each, and a printable
   recovery card with Solana CLI commands for every protected account. A validator can also point its delegators
   to Stakeward.
3. **Second-key holders**: a family member or colleague who receives a `/cosign` link. Each of them sees the
   product from the inside.

### Channels

- **Superteam Georgia** first: the author's local Solana community, for the first mainnet users and live feedback.
  [TODO owner: dates of the meetup or chat posts.]
- **Validators**: direct messages to validators with delegators on native stake; validator chats.
  [TODO owner: list who was contacted.]
- **Security moments**: every public stake theft is a moment to post "check your stake by address" with a short
  explanation of the lockup. The landing page and the "Check your stake" link need no wallet.
- **Telegram alerts** keep users coming back, and each alert links only to the Stakeward site.

### Evidence

Numbers from `/stats` (the monitor's own counts: locked stake accounts it watches, the SOL in them, alerts sent;
locks set with other tools count too, the page says so):

| Date | Locked stake accounts watched | SOL in them | Telegram alerts sent |
| --- | --- | --- | --- |
| [TODO owner] | [ ] | [ ] | [ ] |

- People other than the author who protected stake on mainnet: [TODO owner: count, with permission to cite].
- Validators or teams that tried it: [TODO owner].
- Quotes from first users: [TODO owner: name or handle, role, one sentence, with permission].
- Mainnet proof of the mechanism: docs/gate.md, 8 of 8 checks, 5 October 2026.
- SOL in native stake accounts: about 440 million SOL is staked, around 69% of supply. 441.7M of 635.3M SOL read
  from mainnet with `getVoteAccounts` and `getSupply` (epoch 1050, 6 October 2026; anyone can repeat it); 437.5M SOL,
  68.9%, at the end of September 2026 by Datawallet ("Solana staking statistics", updated 1 October 2026:
  https://www.datawallet.com/crypto/solana-staking-statistics-and-trends). Liquid staking holds a minority of it:
  16.6% by Datawallet (citing Messari), 12% on Solana Compass (https://solanacompass.com/stake-pools, read on
  6 October 2026), 8.7% of active stake by JPool's count (Solana Staking Report, epoch 1000, snapshot of 10 July
  2026: https://jpool.one/research/solana-staking-report-epoch-1000, which also counts 1,497,112 stake accounts). So
  well over 350 million SOL sits in native stake accounts. Say "over 350 million SOL" or "more than 80% of staked
  SOL", not a precise share: the trackers disagree. Exchanges hold a large part of it (30.4% of active stake in
  JPool's count), and Stakeward does not protect stake an exchange holds. Check the live figure on the day of
  recording: https://www.stakingrewards.com/asset/solana/analytics

## 9. How the free product becomes a business

[TODO owner: write this section yourself. The business model is not decided yet; the idea and open questions are in
[BUSINESS-MODEL.md](BUSINESS-MODEL.md).]

Notes only, from CLAUDE.md section 16. Nothing here is built, and the free base stays free.

- The base stays free: protection, monitoring with Telegram, withdraw, rescue, recovery card.
- Paid tiers later, as fiat subscriptions. No token, and no payments in crypto (the author is in Georgia, where
  companies may not accept crypto).
- Pro, for individuals: a phone call on an alert, more alert channels, validator alerts, a check that the second
  key is still alive.
- Teams, for organisations: Slack and webhooks, many accounts, reports, a public confirmation page, an API, roles.

## 10. Code written before 14 September 2026

None. Stakeward was started on 1 October 2026: the first commit in the repository is dated 1 October 2026, and all
code was written during the hackathon. Check with `git log --reverse --format='%ad %s' --date=short | head -1`.
Open-source libraries are used as dependencies and listed with their purpose in docs/DECISIONS.md, section
"Зависимости" (Dependencies).

## 11. Incidents: wording and sources

Use these as public reports, with a source link next to each in the video and the form. Do not claim that
Stakeward would have prevented a specific incident; say what the lock does.

Sources found by two sessions on 6 October 2026, each link opened that day; open each one again before recording and
before submitting.

- **SwissBorg, 8 September 2025.** "SwissBorg lost about 192,600 staked SOL (about $41M). An attacker who got into
  its staking partner's API hid a change of the stake accounts' withdraw authority inside a routine unstaking
  transaction, and SwissBorg's own signers approved it." What the lock does: while a lockup held by a separate second
  key is in force, that change fails with `CustodianMissing` unless the second key signs too (docs/gate.md, check 4
  on mainnet).
  - Kiln post-mortem, 7 October 2025, the primary account of the method:
    https://www.kiln.fi/post/re-enablement-of-kiln-services-and-security-incident-information ("The malicious
    transaction changed the withdrawal authority of the Solana stakes"; it "was approved by a quorum of
    signatories" in the customer's custody; signed on 31 August 2025, detected on 8 September 2025; entry point: a
    stolen GitHub token of a Kiln engineer).
  - Kiln and SwissBorg, announcement of 8 September 2025 (no figures, no method):
    https://www.kiln.fi/post/sol-incident-swissborg---announcement
  - SwissBorg, 17 November 2025: https://swissborg.com/blog/swissborg-security-update-kiln-breach ("During what
    should have been a routine 'deactivate' transaction, the code secretly added extra instructions that changed who
    had control over the staked tokens"; "over 192,000 SOL").
  - The Block, 10 September 2025: https://www.theblock.co/post/370141/kiln-exits-ethereum-validators ("SwissBorg lost
    about 192,600 SOL, worth roughly $41.3 million").
  - Halborn, 15 September 2025: "eight authorization instructions designed to transfer control over several of the
    platform's staking accounts", hidden in an unstaking transaction signed days before the drain; about 192,600 SOL:
    https://www.halborn.com/blog/post/explained-the-swissborg-hack-september-2025
  - QuillAudits, 15 September 2025: from 31 August the attacker's unstaking transaction moved the withdrawal
    authority of several stake accounts; the SOL was drained on 8 September:
    https://www.quillaudits.com/blog/hack-analysis/swissborg-exploit
  - Do not say "MPC failed": neither company says it. SwissBorg says its wallets use MPC; Kiln says a quorum of
    signatories approved the transaction, so "its own signers approved it" follows Kiln. QuillAudits writes in
    passing that there were no "multi-signature confirmations" and names the Staker role there, against its own
    account above and Kiln's post-mortem: follow Kiln. The authority changed on 31 August; the SOL left on 8 September.
- **Step Finance, 31 January 2026.** "261,854 staked SOL (about $29M) were unstaked and taken from Step Finance's
  treasury after attackers compromised its executives' devices." Step's total loss across all assets was about
  $40M: do not put $40M next to the SOL figure.
  - The Block, 31 January 2026: https://www.theblock.co/post/387919 ("approximately 261,854 SOL was unstaked and
    transferred during the incident").
  - BleepingComputer, 3 February 2026: https://www.bleepingcomputer.com/news/security/step-finance-says-compromised-execs-devices-led-to-40m-crypto-theft/
    (the attackers got into "devices belonging to the company's team of executives").
  - Whale Alert, citing CertiK's on-chain data (261,854 SOL unstaked and transferred on 31 January 2026):
    https://whale-alert.io/stories/f18201194ae359/Step-Finance-treasury-wallets-compromised-attacker-unstaked-261854-SOL-26M-STEP-token-plunges-80
  - HackMag, 12 February 2026 (CertiK's first estimate, executives' devices, about $40M in total):
    https://hackmag.com/news/step-finance
  - rekt.news, 4 February 2026: https://rekt.news/step-finance-rekt (the stake authorization was transferred to a
    fresh wallet, then the SOL was unstaked and withdrawn). No official statement names the exact method: say what
    the reports say, and do not claim Stakeward would have stopped it.
- **Ledger owners, 2026.** "Seed-phrase theft keeps hitting Ledger owners: a fake Ledger Live app on Apple's App
  Store took about $9.5M from 50 people in April 2026, and in August 2026 fake Google ads sent Ledger owners to a
  'device check' that asked for their recovery phrase." The August campaign has no reported losses: do not give it
  a number.
  - BleepingComputer, 14 April 2026: https://www.bleepingcomputer.com/news/security/fake-ledger-live-app-on-apples-app-store-stole-95m-in-crypto
  - Zscaler ThreatLabz, 25 September 2026: https://www.zscaler.com/blogs/security-research/threat-actors-use-google-ads-target-ledger-users
    ("In August 2026, Zscaler ThreatLabz analyzed a phishing campaign that used fraudulent Google ads to target
    Ledger hardware wallet users").

## 12. Fact sheet

| Fact | Value | Where it comes from |
| --- | --- | --- |
| Lock periods | 1, 3, 6, 12 months, default 6; ends at 00:00 UTC on the day after the period. Devnet also 10 min and 1 h | `packages/core/src/lockup.ts`, D13 |
| Network fee | 0.000005 SOL per signature plus 600 lamports priority (limit 60,000 CU at 10,000 micro-lamports) | `packages/core/src/constants.ts`, `fees.ts`, D16 |
| Protect one stake account | 2 signatures, 0.0000106 SOL, paid by the Main key | `networkFeeFor`, D23 |
| Rescue one stake account | 3 signatures, 0.0000156 SOL, paid by the New wallet | same |
| Link-signing deposit | about 0.00106 SOL, read from the network, returned on close | D22, landing page |
| Suggested balance on the New wallet | 0.01 SOL | `SUGGESTED_RESCUE_LAMPORTS` |
| Monitoring | every 2 minutes (Cron Trigger `*/2 * * * *`) | `apps/worker/wrangler.jsonc` |
| Reminders | 30, 14, 7, 3 and 1 days before the end, and when it ends | `REMINDER_DAYS`, D58 |
| Accounts per run | up to 10 to protect, up to 10 to rescue | `MAX_ACCOUNTS_PER_RUN`, `MAX_RESCUE_ACCOUNTS` |
| Programs in transactions | Stake, System (durable nonce), Compute Budget; Lighthouse assertions only if Phantom appends them at the end | `inspect.ts`, D23, D24 |
| Message format | legacy messages, no address lookup tables, one stake account per transaction | D17, D23 |
| Mechanism checks | LiteSVM 24/24 (2 Oct), devnet 21/21 (5 Oct), mainnet 8/8 (5 Oct), stake program v5.1.0 | docs/gate.md, D4 |
| Recovery card commands | 26/26 on `solana-test-validator` 4.3.0 (5 Oct) and 26/26 on devnet (6 Oct), Solana CLI 4.3.0 | docs/recovery-cli.md, D78 |
| Automated tests | core 790, web 786, worker 598, scripts 130 (6 Oct 2026); Playwright on every route at 1280 and 360 px | docs/PROGRESS.md |
| Server data | public stake account data and, with alerts on, the Telegram chat id. No accounts, logins, cookies or analytics | CLAUDE.md section 2, FAQ "What does Stakeward know about me?" |
| Not built yet | changing the second key inside Stakeward (the CLI does it in one command), Squads vault as second key, Mobile Wallet Adapter | CLAUDE.md step 10, FAQ |
| Hosting | one Cloudflare Worker (Workers Free plan) with D1; RPC through Helius | DECISIONS "Развёртывание" |
