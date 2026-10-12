# Stakeward: Colosseum submission drafts

Colosseum Crypto World's Fair. Deadline: 12 October 2026, 23:59 PT (13 October, 10:59 Tbilisi).
Drafts as of 11 October 2026, matching the code on `main` (steps 0-9 built; mainnet checks passed on 10-11 October). Every number below comes
from the code or from docs/gate.md; the fact sheet at the end says where. Text in `[TODO owner: ...]` is for the
owner to fill in.

## Before submitting (owner)

- [x] The repository https://github.com/Zhibul-Alexander/stakeward is public (it was private during the build; public as checked on 6 October 2026). Keep it public: the prod deploy reads the CI status without a token.
- [x] Prod runs the current build and has passed the mainnet checks of step 9 (TESTPLAN stage 6, 10-11 October
      2026); the prod address is in section 2.
- [ ] The numbers from `/stats` and the first users' quotes are filled in (section 8).
- [ ] The business section is written (section 9). TODO: the business model is not decided yet; the idea is in
      [BUSINESS-MODEL.md](BUSINESS-MODEL.md).
- [ ] Every incident below has a source link (section 11): links found and opened on 6 October 2026; the owner opens
      and checks each one before recording.
- [ ] The wallet table on the landing page shows the wallet matrix results, and section 4 says the same.
- [ ] Pitch video (up to 2 min, on camera) and product demo (under 3 min) are recorded from the video script (kept outside the repository).
- [ ] Logo uploaded: `docs/brand/logo-512.png` (PNG) or `docs/brand/logo.svg`.
- [ ] Wording: Stakeward is a lock on stake accounts, not a wallet and not two-factor authentication. Say "second
      key", never "backup key" or "guardian".

## 1. Name

Stakeward

## 2. Links

| What | Link |
| --- | --- |
| Repository (MIT) | https://github.com/Zhibul-Alexander/stakeward |
| Product, Solana mainnet | https://stakeward.com |
| Test version, Solana devnet | https://dev.stakeward.com |
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
lockup on your existing stake accounts, for 1, 3, 6 or 12 months or until a date you pick. Your stake keeps earning with its validator.

- **Protect.** Check any wallet's stake by its address, without connecting anything. Then your main key and your
  second key sign one `SetLockupChecked` per stake account. The joint signature on the network is the proof that
  the second key exists and is yours.
- **Alerts.** A Cloudflare Worker reads the watched stake accounts every two minutes and sends a Telegram message
  when one is deactivated, redelegated, split, drained or closed, when its keys or its lock change, and 30, 14, 7, 3
  and 1 days before the lock ends. Once a day it also checks each watched stake's validator and alerts when it stops
  voting, closes its vote account, has no BLS key, lacks the Alpenglow fee balance or takes 100% commission.
- **Rescue.** A stolen key is a copy: the owner still has it. So the main key, the second key and a new wallet
  sign together, and both authorities of each stake account move to the new wallet. This works even if the thief
  already changed who manages staking. The new wallet pays, so the stolen key never pays a fee. With every key in one
  browser each wallet approves all accounts in one request, on a recent blockhash; with a key on another device the
  rescue runs on a durable nonce owned by the new wallet, so the signatures do not race a one-minute blockhash.
- **One-tap rescue (optional).** While all three keys are safe, they sign the rescue in advance. The worker keeps the
  signed transaction and the Telegram chat bound to it gets a Rescue now button under each alert, or the worker sends
  it by itself when someone changes who manages staking. All it can do is move the stake to the user's own new wallet;
  the lock stays.
- **Withdraw, extend, remove.** Both keys withdraw together. The second key alone extends the lock or removes it
  early.
- **Change the second key.** If the second key may be stolen, it and a new second key from a new seed phrase hand the
  lock over in one transaction; the end date stays and the new key pays.
- **Sign by link.** The second key can sign on another device: the partly signed transaction travels in the
  address fragment of a `/cosign` link or a QR code and never reaches the server.
- **Recovery card.** A printable card for each pair of main key and second key: what to do if a key is lost or
  stolen, with Solana CLI commands that work without Stakeward. No secrets on it.

**What a thief with only the main key can and cannot do.** While the lock holds, they can stop the staking,
redelegate, split the account and change the stake authority. They cannot withdraw a single lamport, take the
withdraw authority or touch the lock. Stakeward says this on the landing page in plain words.

**Trust model.** Stakeward never holds funds or keys and never asks for a seed phrase. It has no on-chain program
and no token. The browser builds every transaction from a TypeScript core, the user's own wallets sign, and the
result is checked on the network. The server never builds or signs a transaction; it stores one only for a one-tap
rescue, already signed by all three keys, which can only move the stake to the user's own new wallet. Transactions contain only Stake program instructions for one stake account each,
System instructions for the durable nonce, and Compute Budget. No address lookup tables. A transaction inspector
decodes the exact bytes before every signature: the signing screen shows its summary, `/cosign` trusts only the
bytes and the network, and the worker's RPC proxy sends only transactions the inspector accepts, with every
signature verified. If the Stakeward server is down, users lose alerts and one-tap rescue, not SOL: the lock lives in the stake
program. A hacked server could send a stored one-tap rescue early; that moves the stake to the owner's new wallet,
still locked. The same server delivers the website, so a hacked server is a hacked website that could ask for a harmful
signature; the lock still needs the second key, and the site tells users to check the addresses their wallet or
Ledger shows.

**Honest limits.** Whoever holds the second key cannot move the SOL but can keep it locked, for years if they want.
If you lose the second key, you wait until the lock ends. Two keys from one seed phrase protect nothing. A thief
with the main key can split the stake into many small accounts; each keeps the lock, but one rescue run moves at most
10, so act early and extend the lock first. Stakeward does not cover liquid staking tokens, exchange stake, SOL in a
wallet balance or vote accounts.

**Wallets.** Stakeward talks to browser wallets through the Wallet Standard (Phantom, Solflare, Backpack, and a
Ledger through them). Tested so far: two Phantom accounts from different seed phrases, both in one browser. On
devnet on 8 October 2026, 4 of 4 co-signing runs (recent blockhash and durable nonce, either key first) landed
unchanged. On mainnet on 10-11 October 2026, a real 1.05 SOL stake was protected, unlocked by the second key,
protected again, unstaked by "the thief" with the main key alone (withdrawing stayed impossible) and rescued to a new
wallet and back, with every alert arriving in Telegram. Phantom warns that these transactions "could steal your funds
in the future", and on mainnet it blocked the second key's signature and the rescue as a possible theft until the
owner chose "Proceed anyway"; the signing screen explains this before the wallet asks. On mainnet Phantom, signing
first, reorders a durable-nonce transaction so that it cannot land; Stakeward detects that and refuses to send it, so
signing by link and the one-tap rescue need another wallet to sign first (D121). A Ledger was checked on the official
emulator (Speculos, Nano S Plus and Nano X): 25 of 25 Stakeward transactions shown as readable fields and signed;
not yet on a device. Solflare and Backpack have not been tested. In a phone wallet's own browser you can check stake,
extend or remove a lock and co-sign by link; protecting and rescuing need a computer.

**How it is built.** pnpm monorepo in TypeScript. `packages/core` (pure, no I/O): decoding, lock rules, transaction
builders, inspector, signature checks, monitoring diffs, built on `@solana/kit` 8.4 and `@solana-program/stake`
0.10. `apps/web`: React 19, Vite, Tailwind CSS 4, shadcn/ui, Wallet Standard directly. `apps/worker`: one Cloudflare
Worker with Hono, D1 and a Cron Trigger, serving the site, the API and the Telegram webhook. Strict CSP, no
third-party scripts, fonts or analytics. Ledger: transactions use the account layout the Ledger Solana app parses
into readable fields, checked on its emulator (`pnpm ledger-sim`, docs/ledger-sim.md). About 2,700 automated tests (core 906, web 996, worker 663,
scripts 142 on 11 October 2026), including every transaction kind executed against the mainnet stake program in
LiteSVM, plus Playwright with axe on every route at 1280 and 360 px.

**Status.** Live on Solana mainnet at https://stakeward.com; the owner's mainnet checks passed
on 10-11 October 2026. [TODO owner: N stake accounts and X SOL under lock from `/stats`; first users.]

## 4. Logo

- `docs/brand/logo.svg`: the mark, vector, transparent background. `docs/brand/logo-512.png`: the same mark at
  512 x 512 px for upload forms.
- `apps/web/public/favicon.svg`: the same geometry, used as the site's icon.
- The mark is a shield split into two halves with a keyhole: one lock that answers to two keys. Original artwork,
  no third-party assets.
- Colours are the Second key's tokens of the site's dark theme (`apps/web/src/styles/tokens.css`): accent-ink `#9fbcff`
  (left half), accent `#7fa6ff` (right half), on-accent `#06132e` (keyhole), the blue of the padlock in the key diagram.

## 5. Style for every text

Plain words, short sentences. Roles are always Main key, Second key and New wallet; the stake program's names
(withdrawer, custodian, staker) only in technical answers. Every risk comes with its date or condition. No claim
beyond what docs/gate.md and the tests show: say "not tested yet" where that is true (Ledger, Solflare, Backpack).

## 6. Pitch video script

Moved to the video script (kept outside the repository), section 1 (11 October 2026): Colosseum asks for up to 2:00, with the team on camera.

## 7. Product demo script

Moved to the video script (kept outside the repository), section 2 (11 October 2026): under 3:00, devnet, updated for the current site (custom
lock date, Phantom's block screens, the rescue without a link-signing account when every key signs here, D121).

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
- Pro, for individuals: a phone call on an alert, more alert channels, validator reports beyond the free validator
  health alerts, a check that the second key is still alive.
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

### More incidents (research of 11 October 2026)

Found and opened by a research pass on 11 October 2026 (every quote below was on the fetched page). Only the first
one involves staked SOL. The others are context: liquid SOL, tokens, admin keys or exchange hot wallets, which a
stake-program lockup does not protect. Say that plainly if you use them.

- **Early Solana whale, 10 July 2026, staked SOL.** "approximately 180,900 SOL (about 14.2 million USD) stolen",
  reported as suspected by ZachXBT with Specter Investigation; "abnormal unstaking and cross-chain operations to
  Ethereum"; "the specific method of attack ... still under further investigation". A lockup with a separate second
  key would plausibly have mattered only if the attacker held one key: unverified, do not claim it.
  - https://www.chaincatcher.com/en/article/2275905 (re-checked by hand 11 Oct 2026)
  - https://en.bloomingbit.io/feed/news/116011 ("a large amount of SOL was unstaked from the wallet before the assets were bridged")
  - https://www.bitget.com/news/detail/12560605500106 ("The method used in the attack ... are still unknown.")
- **Step Finance, new detail.** CertiK, via TradingView/Cryptonews: the SOL "has been withdrawn after stake
  authorization had been transferred"; Cointelegraph: the team "did not disclose how the attacker gained access".
- **One user, early December 2025, about $3M.** A phishing signature changed the wallet account's Owner (`assign`);
  the stake-account version of this trick is Authorize(Withdrawer), which an active lockup refuses without the
  second key. Essentially one primary source (SlowMist).
  - https://panews.io/articles/397198c5-b7fe-4262-b79b-a87c8109ca8e ("over $3 million worth of assets stolen"; "The `assign` command changes the account's Owner")
  - https://coinpaper.com/12892/solana-user-loses-3-m-as-hidden-wallet-permissions-exploited
- **Drift Protocol, 1 April 2026, about $285M (USDC, JLP).** Multisig signers were led to pre-sign durable-nonce
  transactions with hidden admin authorizations. Not staked SOL; relevant to how Stakeward treats pre-signed rescues
  (D118). https://www.trmlabs.com/resources/blog/north-korean-hackers-attack-drift-protocol-in-285-million-heist ;
  https://crypto.news/drift-protocols-285m-hack-exposes-social-engineering-threat-to-solana-defi/
- **Upbit hot wallet, 27 November 2025, 44.5B KRW (about $30M; Decrypt and Halborn: about $36M)** of Solana assets;
  cause unconfirmed. https://www.koreatimes.co.kr/amp/economy/cryptocurrency/20251127/upbit-loses-near-301-mil-in-massive-hacking-attack ;
  https://decrypt.co/350196/south-koreas-upbit-36-million-loss-solana-hot-wallet-breach
- **DEXX, 16 November 2024, $21M at first, later "within $30M", 900+ users:** a platform private key leak.
  https://cointelegraph.com/news/solana-dexx-hack-november-2024-suspicious-wallets ; https://www.chaincatcher.com/en/article/2152336
- **@solana/web3.js 1.95.6 and 1.95.7, 2 December 2024:** an npm backdoor sent out private keys; about $160,000 in
  SOL plus over $31,000 in tokens. https://decrypt.co/294742/solana-web3-js-library-compromised-in-targeted-supply-chain-attack ;
  https://www.cyfrin.io/blog/critical-security-alert-solana-web3-js-library-compromise
- **Wallet drainers, December 2023 to January 2024:** "nearly $4.17 million in assets from about 3947 victims"
  (ScamSniffer; Decrypt says 3,967 wallets), mostly direct transfers.
  https://drops.scamsniffer.io/over-4-million-stolen-by-multiple-solana-wallet-drainers/ ;
  https://decrypt.co/212875/hackers-steal-over-4-million-fake-airdrops-other-scams-solana
- **Raydium, 16 December 2022:** the AMM owner key was compromised; about $4.4M (Raydium) or $5.5M (CertiK).
  https://www.theblock.co/post/195712/solana-based-exchange-raydium-suffers-2-million-exploit ;
  https://www.certik.com/blog/raydium-protocol-exploit-incident-analysis
- **Slope wallet, 2–3 August 2022:** the app sent key material to a monitoring service; "drained 9,231 wallets of
  approximately $4.1 million" (Solana Foundation; early reports said about 8,000 wallets and $8M).
  https://solana.com/news/8-2-2022-application-wallet-incident ; https://techcrunch.com/2022/08/03/solana-wallet-hack/
- Not found: any sourced case of a private person losing staked SOL to a phishing Authorize transaction. Do not say
  such cases are documented.

## 12. Fact sheet

| Fact | Value | Where it comes from |
| --- | --- | --- |
| Lock periods | 1, 3, 6, 12 months, default 6; ends at 00:00 UTC on the day after the period. Or a custom date from tomorrow to 10 years ahead, ending at 00:00 UTC on it (D119). Devnet also 10 min and 1 h | `packages/core/src/lockup.ts`, D13 |
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
| Automated tests | core 906, web 996, worker 663, scripts 142 (11 Oct 2026); Playwright on every route at 1280 and 360 px | docs/PROGRESS.md |
| Server data | public stake account data and, with alerts on, the Telegram chat id; a one-tap rescue the user signed in advance, if they prepare one (D118). No accounts, logins, cookies or analytics | CLAUDE.md section 2, FAQ "What does Stakeward know about me?" |
| Not built yet | Squads vault as second key, Mobile Wallet Adapter, signing a second key change by link | CLAUDE.md step 10, FAQ |
| Hosting | one Cloudflare Worker (Workers Free plan) with D1; RPC through Helius | DECISIONS "Развёртывание" |
