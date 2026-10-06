# Stakeward

Stakeward puts a lock on the Solana stake accounts you already have. The lock is built into Solana's own stake program, and it answers to your **second key**: a wallet of yours made from a different seed phrase. While the lock holds, a thief who gets your **main key**, the wallet you stake from, cannot withdraw your stake or make it theirs. You can still move the stake to a new wallet with both keys.

Stakeward never holds your SOL or your keys. Your browser builds every transaction, your own wallets sign it, and Stakeward has no program of its own on the network. It is free: you pay only Solana network fees.

> **Status: work in progress.** Protecting, alerts, withdrawing, extending the lock, rescue, signing by link and the recovery card are built and pass automated tests against the real stake program. The checks with real wallets are still under way, and no wallet is verified yet. A devnet demo runs at https://stakeward-dev.zhibul-alexander.workers.dev (devnet SOL has no value). The mainnet version is not public yet. Do not lock real stake with Stakeward until this note changes.

## Why your stake needs a lock

A native stake account has two keys. One manages staking: it delegates, stops staking and splits the account. The other controls the money: it withdraws SOL and can hand both keys to another wallet. Usually both are the key of the wallet you staked from. Whoever gets that key owns your stake. Keys leak through fake websites, stolen seed phrases, malware, or a hidden step in a transaction you approved. In 2025 and 2026, hundreds of thousands of staked SOL were stolen this way.

Every stake account also has a lock built in: an end date and a key that guards it. While the lock holds, withdrawing and handing the stake to another wallet need the guarding key's signature too. The Solana documentation says a lock can be set only when a stake account is created. The stake program's code lets the main key set a new lock on an existing account whenever no lock is in force, and while one is in force, only the guarding key can change it. Stakeward makes your second key that guarding key.

## How it works

1. **Lock it with a second key.** Pick a wallet made from a different seed phrase as your second key. Your main key and your second key sign together, one transaction per stake account, and the lock is written into each stake account on the Solana network. Your stake stays with its validator and keeps earning.
2. **Get alerts.** Stakeward checks your protected stake accounts every few minutes. If you turn on alerts, a Telegram message tells you when anything changes. It also reminds you 30, 14, 7, 3 and 1 days before the lock ends, and when it ends.
3. **Rescue or withdraw.** If your main key is stolen, your main key, your second key and a new wallet sign together before the lock ends, and the stake moves to the new wallet, out of the thief's reach. To take your SOL out, your two keys withdraw it together.

The lock lasts 1, 3, 6 or 12 months, 6 by default. It ends at 00:00 UTC, on the first midnight after that period. Your second key can extend the lock, or remove it early, at any time before it ends. After it ends, your main key alone controls the stake again, and you can protect it again. On devnet you can also try a 10-minute or a 1-hour lock.

You can look before you connect anything: paste a wallet address and see which of its stake accounts are protected. Stakeward asks for a wallet only when you act.

## What Stakeward protects

**Covered:** native stake, that is SOL you delegated to a validator from your own wallet. It sits in a stake account that your keys control.

**Not covered:** liquid staking tokens (LSTs), stake on an exchange, SOL in your wallet balance, validator vote accounts.

While the lock holds:

| Action | Who can do it |
| --- | --- |
| Withdraw SOL from the stake account | the main key and the second key together |
| Hand the stake to another wallet | the main key and the second key together |
| Extend, shorten or remove the lock, or hand it to another key | the second key only |
| Stop staking, move the stake to another validator, split the stake account, change the key that manages staking | the main key alone |

So a thief with only your main key can stop your rewards, move your stake to a validator of their choice, or split it into smaller stake accounts, each with the same lock. They cannot take the SOL. If an alert surprises you, rescue your stake before the lock ends.

## The second key: read this first

- **Whoever holds your second key can freeze your stake.** The second key cannot move your SOL, but it can set any end date, even years ahead, and hand the lock to any other key. Guard it as carefully as your main key.
- **Make it from a different seed phrase.** One seed phrase makes all of its wallets. If one phrase makes both keys, whoever steals it has both, and the lock stops nothing. A second account in the same wallet app usually comes from the same seed phrase, unless you imported it from its own. Stakeward asks you to confirm this, but it cannot check it for you.
- **Keep it apart from your main key:** on a hardware wallet, on another device, or with a person you trust. A person who holds your second key co-signs by link from their own device.
- **If you lose it,** your SOL is safe, but it stays locked until the lock's end date. Nobody can shorten the wait, not even Stakeward. After that, your main key alone controls the stake again.
- **If someone steals it,** they cannot take your SOL, but they can keep it locked. Hand the lock to a new second key at once: see [Second key stolen](#second-key-stolen).
- **It is not a backup of your main key.** If you lose your main key, the second key cannot withdraw or move the stake. Keep a safe backup of your main key's seed phrase.

## What Stakeward cannot do

- It cannot protect liquid staking tokens, stake on an exchange, SOL in your wallet balance or validator vote accounts.
- It cannot stop a thief with your main key from stopping your staking or moving it to another validator. While the lock holds, they still cannot take the SOL.
- It cannot keep a thief out after the lock ends. If your main key may be stolen, rescue your stake before that date.
- It cannot help if you lose your main key. Withdrawing always needs the main key, with or without the lock.
- It cannot shorten the wait if you lose your second key. The lock ends on its date, not before.
- It cannot stop whoever holds your second key from keeping your stake locked.
- It cannot protect you if one seed phrase makes both of your keys.
- It cannot lock stake accounts you create later in your wallet. Protect each new one too.
- It cannot make recovery without Stakeward work with keys that live only in a browser wallet: the Solana command line needs your keys on a Ledger or in keypair files.
- It cannot move your SOL, sign for you or change your lock. Only your own wallets can.
- It cannot promise alerts. If Stakeward is down, alerts come late or not at all. The lock itself keeps working.
- It cannot see your keys or your seed phrase, and it never holds your SOL.
- It cannot yet hand the lock to a new second key in one step. The Solana command line can: see [Second key stolen](#second-key-stolen).

## What it costs

Stakeward is free. There is no token, no subscription and no payment in crypto. You pay only the Solana network fee for each transaction, and Stakeward gets none of it. Each signing screen shows the fee before you sign.

The network charges 0.000005 SOL for each signature. Every Stakeward transaction also sets the same small, fixed priority fee of 0.0000006 SOL (a limit of 60,000 compute units at 10,000 micro-lamports each).

| Action | Signatures | Network fee | Paid by |
| --- | --- | --- | --- |
| Protect one stake account | 2 | 0.0000106 SOL | the main key |
| Extend or remove the lock | 1 | 0.0000056 SOL | the second key. If it has no SOL, the main key signs too and pays 0.0000106 SOL |
| Stop staking, before a withdrawal | 1 | 0.0000056 SOL | the key that manages staking, usually the main key |
| Withdraw | 2 | 0.0000106 SOL | the main key |
| Rescue one stake account | 3 | 0.0000156 SOL | the new wallet |
| Open or close a link-signing account | 1 | 0.0000056 SOL | the wallet that owns it |

**The link-signing account is a deposit, not a fee.** To sign on another device, and in every rescue, Stakeward opens a small helper account on the network (a durable nonce account) that keeps the transaction valid until the last signature, even hours later. The network asks for a deposit to keep it open. Stakeward reads the amount from the network; today it is about 0.00106 SOL. When you close the account, the deposit comes back to your wallet.

For a rescue, put about 0.01 SOL on the new wallet: it pays every fee and owns the link-signing account. The main key pays nothing in a rescue, because a thief's bot may empty a stolen wallet at any moment.

## Which wallets work

**No wallet has been verified with Stakeward yet.** Tests with Phantom are under way on devnet: two Phantom accounts, the second one imported from a different seed phrase. Solflare, Backpack and Ledger have not been tested. A pair of wallets will be listed as working, here and in the wallet table on the site, only after it has been tested. Until then, try every step on devnet first, and then with a small stake.

What we know so far comes from wallet documentation and source code, not from tests:

- Stakeward talks to browser wallets through the Wallet Standard. It lists any wallet that offers `standard:connect` and `solana:signTransaction` for legacy transactions on the right cluster. Being listed does not mean the wallet was tested.
- Stakeward asks a wallet only to sign a transaction. It never asks a wallet to sign a message or to send a transaction: Stakeward sends it, after checking every signature.
- Phantom may add its own safety-check instructions (Lighthouse) to the end of a transaction. Stakeward accepts only that change, checks that nothing else changed, and asks Phantom to sign first.
- To sign on the spot, every wallet that signs must be connected in one browser: two wallets from different seed phrases to protect or withdraw, three to rescue. With signing by link, a wallet on another device signs instead.
- A Ledger connects through a browser wallet. Stakeward builds each transaction in the shape that Ledger's Solana app shows as readable fields, according to that app's source code. This has not been checked on a device yet. Phantom's added instructions may make a Ledger ask for blind signing. The FAQ on the site lists the fields a Ledger should show.
- On a phone, a wallet app's own browser offers only that wallet. There you can check your stake, extend or remove a lock, and co-sign by link. Protect and rescue on a computer.

## How Stakeward keeps you safe

- **The lock lives on the Solana network,** inside your stake accounts, enforced by Solana's own stake program. It does not depend on Stakeward. If Stakeward disappears, the lock keeps working and ends on its date; only the alerts stop. See [Recover without Stakeward](#recover-without-stakeward).
- **Non-custodial.** Your SOL stays in your own stake accounts. Stakeward never asks for, creates, stores or sends a seed phrase or a private key. If anyone asks for your seed phrase in Stakeward's name, it is a scam.
- **No program of its own.** Transactions use only Solana's stake program, the system program (for the link-signing account) and the compute budget fee settings; Phantom may add its own safety checks at the end. There is no Stakeward program to upgrade or break into, and no token.
- **Your browser builds, your wallets sign.** Every transaction is built in your browser and signed by your own wallets. Stakeward's server never builds, stores or signs a transaction, and never sees a key.
- **You see what you sign.** Before each signature, the screen shows what changes, who signs, what it costs and what the transaction cannot do. That summary is read from the exact bytes your wallet receives, not from what the page believes. After each signature, Stakeward checks that the wallet changed nothing it should not have.
- **The network decides what happened.** After each action, Stakeward reads the stake accounts again. Nothing counts as done until the network shows it.
- **The server passes on only Stakeward transactions.** It sends a transaction to the network only if the same check accepts it and every signature is valid, so nobody can use it to relay other transactions. If the server is down, you lose the site and the alerts, not SOL.
- **Little data.** The server keeps public network data and, if you turn on alerts, your Telegram chat id. There are no accounts, logins, email, cookies, analytics or third-party scripts. Your browser remembers which wallet you used for each key and which stake accounts you protected; that stays on your device.
- **Open code, not audited.** The code is open source. It has not been audited. Every kind of transaction is tested against the real stake program, and the lock rules were checked on LiteSVM, devnet and mainnet: see [docs/gate.md](docs/gate.md) (in Russian, with explorer links). Read the code, or ask someone you trust to read it, before you lock a large stake.

### If Stakeward were hacked

The same server delivers the website, so whoever took it over could change the page you see. They could:

- ask your wallets to sign a harmful transaction, for example one that makes their wallet your second key, names their wallet as the new wallet in a rescue, or withdraws to their address. So read what your wallet or Ledger shows before you approve: the second key, the new wallet and the address you withdraw to must be yours;
- show a field for your seed phrase. Stakeward never asks for it: never type it in;
- show you a wrong status for your stake accounts, or stop the alerts.

They could not:

- sign anything or move any SOL on their own: Stakeward holds no keys;
- withdraw a locked stake, hand it to another wallet or change its lock unless your second key signs too;
- change how the lock works: that is the stake program's rule, not Stakeward's;
- stop you from recovering with the Solana command line, as below.

A fake Stakeward site is the same danger. Type the address yourself or use a bookmark. After you protect your stake, open your accounts with your second key connected: a stake account marked Locked by another key is not locked by your key.

## Recover without Stakeward

The lock lives in the Solana stake program, not in Stakeward. If Stakeward is down or gone, nothing changes for your stake; only the Telegram alerts stop. The commands below talk to the network directly with the Solana command line. The stake commands were run with Solana CLI 4.3.0 against a test cluster: [docs/recovery-cli.md](docs/recovery-cli.md) lists every run and its results. The recovery card that Stakeward prints for your stake accounts has the same commands.

The commands use `--url mainnet-beta`. On devnet, write `--url devnet` instead.

### What you need

Solana CLI 4.3.0. On Linux or macOS, install it with:

```sh
sh -c "$(curl -sSfL https://release.anza.xyz/v4.3.0/install)"
```

On Windows, use the [install page](https://docs.anza.xyz/cli/install). If a newer version rejects a command here, install version 4.3.0.

- **One computer you trust, with every key that signs a command on it at the same time,** as a keypair file or on a Ledger. If another person holds your second key, they bring their Ledger to that computer.
- **A key that lives only in a browser or phone wallet cannot sign these commands.** Use Stakeward, or wait until the lock ends: after that, your main key alone can withdraw, in any wallet that can withdraw stake.
- **Replace each placeholder, including `<` and `>`:**
  - `<MAIN_KEY_ADDRESS>`: your main key's address. Only the command that lists your stake accounts uses it.
  - `<STAKE_ACCOUNT>`: the address of one stake account. Run the command once for each stake account.
  - `<MAIN_KEY>`, `<SECOND_KEY>`, `<NEW_WALLET>`, `<NEW_SECOND_KEY>`: where that key is. Write the path to its keypair file, or its Ledger as `"usb://ledger?key=0"` with the double quotes: without them, zsh reads `?` as a file pattern.
  - `<NEW_END_DATE>`: a date and time in UTC, like `2027-04-12T00:00:00Z`.
- **The key after `--fee-payer` pays the network fee,** about 0.000005 SOL for each signature, so it needs a little SOL. Never let a key that may be stolen pay: a thief's bot can empty it at once.
- **Never type a seed phrase into a command or a website.**

Each command is shown over several lines, and every line but the last ends with `\`. Bash and zsh (Linux, macOS) accept it as shown. In Windows PowerShell or cmd, type it on one line and leave out every `\`.

To find which Ledger key is yours, connect the Ledger, open its Solana app and run the command below. Try `"usb://ledger"` first, then `key=0`, `key=1`, `key=2`, then `key=0/0`, `key=1/0` and so on, until it prints the address of your key. If none of them does, use Stakeward, or wait until the lock ends. These commands have not been tried with a real Ledger yet.

```sh
solana-keygen pubkey "usb://ledger?key=0"
```

### Find your stake accounts

List every stake account of your main key, including any that a thief split off:

```sh
solana stakes \
  --withdraw-authority <MAIN_KEY_ADDRESS> \
  --url mainnet-beta
```

Show the keys and the lock of one stake account:

```sh
solana stake-account \
  <STAKE_ACCOUNT> \
  --url mainnet-beta
```

The command line has its own names for the keys. Your main key is the withdraw authority. Your second key is the lockup custodian. The key that manages staking is the stake authority; it is usually your main key. While a lock holds, `Lockup Timestamp` is the time it ends and `Lockup Custodian` is your second key.

### Main key stolen

Without the second key, the thief cannot withdraw your stake or make it theirs. They can stop the staking and split the stake account. When the lock ends, the main key alone can withdraw, so the thief can too. Move every stake account to a new wallet well before then, at least a day earlier.

1. Work on a computer you trust, not the one where the main key may have leaked. If you can, keep the second key and the new wallet each on its own Ledger, made from its own seed phrase: a Ledger key never leaves the device.
2. If you cannot finish soon, first extend the lock with the second key alone, as in [Extend or remove the lock](#extend-or-remove-the-lock). The thief cannot undo that, and the stolen key signs nothing.
3. Create a new wallet from a new seed phrase: a new Ledger, a spare Ledger reset with a new seed phrase, or a keypair file made with `solana-keygen new` on that trusted computer. Never use the Ledger that holds your main key or your second key, not even another account on it: every account on one Ledger comes from that Ledger's seed phrase, and whoever has the seed phrase has the new wallet too. Send the new wallet about 0.01 SOL for the fees. Do not send SOL to the stolen main key: a bot may take it at once.
4. List every stake account of the main key, as in [Find your stake accounts](#find-your-stake-accounts).
5. Run this for each stake account. The main key, the second key and the new wallet all sign; the new wallet pays:

```sh
solana stake-authorize-checked \
  <STAKE_ACCOUNT> \
  --stake-authority <MAIN_KEY> \
  --withdraw-authority <MAIN_KEY> \
  --new-stake-authority <NEW_WALLET> \
  --new-withdraw-authority <NEW_WALLET> \
  --custodian <SECOND_KEY> \
  --fee-payer <NEW_WALLET> \
  --url mainnet-beta
```

This works even if the thief changed who manages staking. The lock and its end time stay. From then on the new wallet is your main key: use it wherever this page says `<MAIN_KEY>`. If the stake stopped earning, stake it again from the new wallet, in Stakeward or in a wallet app that holds the new wallet.

When every stake account is moved, run the command that lists them again: the thief may have split off another one in the meantime. Move each one it still lists, until it lists none.

### Withdraw

If your main key may be stolen, do not withdraw to it. Move the stake to a new wallet instead, as in [Main key stolen](#main-key-stolen).

If the stake is Active or Activating, stop staking first. It stops at the end of the epoch, within about 2 days. The second command shows the time left:

```sh
solana deactivate-stake \
  <STAKE_ACCOUNT> \
  --stake-authority <MAIN_KEY> \
  --fee-payer <MAIN_KEY> \
  --url mainnet-beta
```

```sh
solana epoch-info \
  --url mainnet-beta
```

If staking is managed by another key (the stake authority is not your main key), that key or its service stops the staking, not your main key.

When the stake is Inactive, withdraw everything to your main key. Both keys sign; the main key pays the fee:

```sh
solana withdraw-stake \
  <STAKE_ACCOUNT> \
  <MAIN_KEY> \
  ALL \
  --withdraw-authority <MAIN_KEY> \
  --custodian <SECOND_KEY> \
  --fee-payer <MAIN_KEY> \
  --url mainnet-beta
```

Main key and second key not on the same computer? First stop staking and wait until the stake is Inactive. Only then does the second key remove the lock, and the main key withdraws right after. Between the two commands, whoever holds the main key can withdraw alone, so keep that gap short:

```sh
solana stake-set-lockup \
  <STAKE_ACCOUNT> \
  --lockup-date 1970-01-01T00:00:00Z \
  --custodian <SECOND_KEY> \
  --fee-payer <SECOND_KEY> \
  --url mainnet-beta
```

```sh
solana withdraw-stake \
  <STAKE_ACCOUNT> \
  <MAIN_KEY> \
  ALL \
  --withdraw-authority <MAIN_KEY> \
  --fee-payer <MAIN_KEY> \
  --url mainnet-beta
```

The same command withdraws with the main key alone once the lock has ended.

### Extend or remove the lock

While the lock holds, only the second key can change it. After the lock ends, the second key can no longer change it, and the command line cannot lock the stake again (see below).

To extend the lock, replace `<NEW_END_DATE>` with the new end time, like `2027-04-12T00:00:00Z`. Check the year: a date in the past removes the lock instead of extending it. The second key signs and pays:

```sh
solana stake-set-lockup \
  <STAKE_ACCOUNT> \
  --lockup-date <NEW_END_DATE> \
  --custodian <SECOND_KEY> \
  --fee-payer <SECOND_KEY> \
  --url mainnet-beta
```

If the second key has no SOL for the fee, write `<MAIN_KEY>` after `--fee-payer` instead: the main key then pays and signs too. Not if your main key may be stolen: send the second key a little SOL instead.

To remove the lock now, run the command below. After it, the main key alone can withdraw, and so can anyone who holds it:

```sh
solana stake-set-lockup \
  <STAKE_ACCOUNT> \
  --lockup-date 1970-01-01T00:00:00Z \
  --custodian <SECOND_KEY> \
  --fee-payer <SECOND_KEY> \
  --url mainnet-beta
```

### Second key stolen

The thief cannot take your SOL, but they can move the lock date or hand the lock to their own key, and freeze the stake. Act first: hand the lock to a new second key. Make it from a new seed phrase: use a new Ledger, a spare Ledger reset with a new seed phrase, or a keypair file made with `solana-keygen new`. Never use the Ledger that holds your main key or your second key, not even another account on it: every account on one Ledger comes from its seed phrase. The old second key and the new one both sign; the new one pays, because a stolen key must never pay. The end time stays the same.

```sh
solana stake-set-lockup-checked \
  <STAKE_ACCOUNT> \
  --new-custodian <NEW_SECOND_KEY> \
  --custodian <SECOND_KEY> \
  --fee-payer <NEW_SECOND_KEY> \
  --url mainnet-beta
```

If the thief got there first, only their key can change the lock now, and the stake stays locked until the time they chose. Your SOL still cannot leave without the main key.

### What no one can undo

- Whoever holds the second key can freeze the stake: they can set any end date and hand the lock to any key. Guard the second key as carefully as the main key.
- If you lose the second key, you wait until the lock ends. Until then nobody can withdraw the stake or move it to a new wallet, not even you. After that, the main key alone can withdraw, so keep it safe until then.
- The second key is not a backup of the main key. If you lose the main key, nobody can withdraw this stake or move it, not even with the second key. Keep a backup of the main key's seed phrase.
- If you lost the main key and someone else may have it, extend the lock with the second key before each end time. The stake stays stuck, but nobody can take it.
- A thief with only the main key can stop the staking, stake with another validator, split the stake account and change who manages staking. While the lock holds, they cannot withdraw, take the main key's place or change the lock.
- If the second key is lost and the main key is stolen, the thief can withdraw as soon as the lock ends.
- If you lose both keys, nobody can recover this stake. If someone has both keys, they can take it.
- The Solana command line cannot lock the stake again with the main key after a lock has ended: CLI 4.3.0 refuses because the old lock names another key. Protect the stake again in Stakeward.
- Two keys from one seed phrase protect nothing: whoever has the seed phrase has both keys. The second key must come from a different seed phrase.

## For developers

### Names

The site says Main key, Second key and New wallet. The stake program and the Solana command line say:

| Stakeward | Stake program |
| --- | --- |
| Main key | withdraw authority (withdrawer); usually also the stake authority (staker) |
| Second key | lockup custodian |
| New wallet | the key a rescue makes both withdrawer and staker |
| Link-signing account | durable nonce account |

### What goes on the network

| Action | Instructions | Signers | Fee payer |
| --- | --- | --- | --- |
| Protect | `SetLockupChecked`: `unix_timestamp` = end date, epoch unchanged, new custodian = second key | main key, second key | main key |
| Extend or remove | `SetLockup`: only `unix_timestamp` (0 removes the lock) | second key, and the main key when it pays | second key, or the main key if the second key has no SOL |
| Stop staking | `Deactivate` | staker | staker |
| Withdraw | `Withdraw` of the whole balance to the main key, custodian signing | main key, second key (the main key alone once the lock is gone) | main key |
| Rescue | `AuthorizeChecked(Staker → new wallet)` + `AuthorizeChecked(Withdrawer → new wallet)`, always on a nonce owned by the new wallet | main key, second key, new wallet | new wallet |
| Stake again after a rescue | `DelegateStake` | new wallet | new wallet |
| Link-signing account | System `CreateAccountWithSeed` + `InitializeNonceAccount`; closing is `WithdrawNonceAccount` | its owner | its owner |

Every transaction has one shape: `[AdvanceNonceAccount, if on a nonce] [compute unit limit] [compute unit price] [one stake instruction on one stake account]`, where a rescue is the one allowed pair. Messages are legacy, with no address lookup tables. Stake instructions use the legacy account order with sysvars, which the Ledger Solana app parses ([D1](docs/DECISIONS.md)). Phantom's Lighthouse instructions are accepted only at the end.

`inspectTransaction(bytes)` in `packages/core` reads a transaction only from its bytes and returns a typed summary: kind, stake account, amount, new keys, new lock, fee payer, lifetime, required and present signatures. It accepts only the shape above and rejects any other program, instruction or lookup table. It runs on every signing screen, on `/cosign`, and in the worker's RPC proxy before `simulateTransaction` and `sendTransaction`. Signing order: Phantom first, on an unsigned transaction; then the fee payer; then the rest. After each signature, `checkSigningStep` compares the message with the one sent; before sending, `verifyAllSignatures` checks every signature.

Signing by link puts the partly signed transaction in the URL fragment, `/cosign#tx=<base64url>`, which browsers never send to the server. The transaction is on a durable nonce, so it stays valid until the last signature. Closing the link-signing account cancels the link ([D68](docs/DECISIONS.md)).

The lock rules were checked against the real stake program, 14 checks from the build spec: [docs/gate.md](docs/gate.md) has the LiteSVM, devnet and mainnet runs with transaction signatures and error codes.

### Repository layout

A pnpm monorepo:

| Path | What it is |
| --- | --- |
| `packages/core` | Pure TypeScript with no I/O: stake account decoding, lock rules, stake status, transaction builders, the inspector, signature checks, snapshot diffs for alerts, error texts, recovery card commands. Used by the site, the worker, the scripts and the tests. Test doubles (`LiteSvmChain`, an in-memory test wallet, a LiteSVM harness with the mainnet stake program v5.1.0) are in `packages/core/test`. |
| `apps/web` | The site: Vite, React 19, TypeScript, Tailwind CSS 4, shadcn/ui on Radix, lucide-react. Design tokens in `src/styles/tokens.css`, every UI string in `src/i18n/en.json`. `/dev/ui` shows every component in every state (devnet build only). |
| `apps/worker` | One Cloudflare Worker on Hono: serves the built site, the API under `/api/*`, the monitor (a Cron Trigger every 2 minutes) and the Telegram webhook. Data in D1; schema only through `migrations/`. |
| `scripts` | The mechanism check (`gate`), devnet test accounts (`dev-accounts`), an RPC check (`check-rpc`) and a runner for the recovery card's CLI commands (`recovery-cli`). |
| `docs` | `PROGRESS.md`, `DECISIONS.md`, `TESTPLAN.md`, `gate.md`, `recovery-cli.md` (all in Russian) and screenshots in `screens/`. |

`CLAUDE.md` is the build spec (in Russian). Every deviation from it is recorded in `docs/DECISIONS.md`.

The site reaches the outside world through two ports defined in core: `ChainPort` (read accounts, the epoch and a blockhash, simulate, send, wait for a signature) and `WalletPort` (an address and "sign these transactions"). In production they are `HttpChain` over `/api/rpc` and Wallet Standard wallets; in tests, `LiteSvmChain` and the in-memory test wallet. The cluster is fixed at build time (`VITE_CLUSTER=devnet` or `mainnet`); `/dev` pages and test code are not in the mainnet build, and a test checks that.

The worker's API:

| Route | What it does |
| --- | --- |
| `GET /api/stake-accounts?withdrawer=` or `?custodian=` | stake accounts of a key, via `getProgramAccounts`, decoded |
| `POST /api/watch` | reads each account from the network and starts watching it only if it is a stake account with a lock in force |
| `GET /api/accounts?wallet=` | watched accounts where the wallet is the main or second key, with recent events |
| `POST /api/rpc` | JSON-RPC proxy: an allow-list of methods with strict params; `simulateTransaction` and `sendTransaction` only for transactions the inspector accepts with valid signatures |
| `POST /api/telegram/webhook` | the bot's webhook, checked with the secret token header |
| `GET /api/telegram/link?wallet=` | redirects to the bot with `/start <wallet>` |
| `GET /api/health` | time of the last successful monitor pass; HTTP 503 when it is older than 10 minutes |
| `GET /api/stats` | stake accounts under a lock, SOL under a lock, alerts sent |

### Requirements

- Node 24.15 or newer and pnpm 12.8.1 (the version in `package.json`).
- Linux or macOS. The LiteSVM tests use a native module that does not support Windows.
- For the recovery card runner only: Solana CLI 4.3.0.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Versions are exact and the lockfile is committed: always install with `--frozen-lockfile`. `pnpm build` builds the site for devnet and dry-runs the worker deploy.

### Tests

Four automated layers run in GitHub Actions on every push, with `pnpm audit`:

1. **Core** (`packages/core`): unit tests, and integration tests on LiteSVM with the mainnet stake program build v5.1.0. Every builder runs on LiteSVM; every kind of transaction goes through the inspector; the inspector and the signature checks reject what they must.
2. **Worker** (`apps/worker`): tests inside workerd (`@cloudflare/vitest-pool-workers`) with a local D1 and fake RPC and Telegram: the RPC proxy, `/api/watch`, the monitor (each event once, reminders, pass limits), the webhook, rate limits and security headers.
3. **Product scenarios** (`apps/web`): Vitest and Testing Library in jsdom, real components and real stake program transactions on `LiteSvmChain` with in-memory test wallets: protect, withdraw, extend, rescue and `/cosign`, plus a wallet that refuses, a wallet that changes the message, an expired blockhash and partial success.
4. **Browser** (`apps/web/e2e`): Playwright on the built site, served under the production headers and CSP, with a mocked `/api`. Every route at 1280 and 360 px wide, no console errors, axe in light and dark themes, printing of the recovery card; the same smoke run on the mainnet build.

`scripts` has its own tests too: the mechanism check runs on LiteSVM, and a test checks that every command in [Recover without Stakeward](#recover-without-stakeward) matches the recovery card. The fifth layer is manual: [docs/TESTPLAN.md](docs/TESTPLAN.md), first on devnet, then on mainnet with a small stake.

Run one package's tests with `pnpm --filter @stakeward/core test` (or `@stakeward/web`, `@stakeward/worker`, `@stakeward/scripts`).

### Playwright locally

```sh
pnpm --filter @stakeward/web exec playwright install chromium
pnpm e2e
pnpm e2e:mainnet
```

`pnpm e2e` builds the devnet site and runs the tests; `pnpm e2e:mainnet` does the same with the mainnet build. Chromium needs system libraries. With root, `playwright install --with-deps chromium` installs them, as CI does. Without root, `scripts/playwright-local-libs.sh` unpacks them into `.cache/pw-libs` and prints an `export LD_LIBRARY_PATH=…` line to run first. `UPDATE_SCREENS=1 pnpm e2e` rewrites the screenshots in `docs/screens`.

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm gate:litesvm` | the mechanism check on LiteSVM |
| `pnpm gate:devnet`, `pnpm gate:mainnet` | the same on devnet, or a short version on mainnet with a throwaway key in `.keys/`. Without funds they print the address and the exact amount to send, and stop. Everything but the fees goes back at the end. |
| `pnpm dev-accounts <address>` | creates a delegated and an undelegated stake account for an address on devnet |
| `pnpm check-rpc <url>` | checks that an RPC endpoint answers `getProgramAccounts` with the stake filters |
| `pnpm recovery-cli --url devnet`, or `--url localhost --funder <keypair>` with `solana-test-validator` | runs every recovery card command with Solana CLI 4.3.0 against that cluster and records the results in `docs/recovery-cli.md`; refuses mainnet |

Keys for scripts and tests live in `.keys/` (gitignored). They are test data, never product code.

### Deployment

Two Wrangler environments, each with its own D1 database, Telegram bot, RPC URL and secrets:

- `dev`: Solana devnet, https://stakeward-dev.zhibul-alexander.workers.dev. It also offers 10-minute and 1-hour locks and the `/dev` pages.
- `prod`: Solana mainnet. Its address is published after the mainnet checks in the test plan.

```sh
pnpm deploy:dev
pnpm deploy:prod --prod-confirm
```

Both run `scripts/deploy.ts`. It deploys only the committed HEAD of a clean tree, and only when that commit is on origin; for prod, also only once the CI job `check` has passed on it (GitHub's check runs, read without a token). It installs with the frozen lockfile, builds the site for the environment's cluster with no secret in the environment, runs the build guards on that very build, and gives the Cloudflare token and account id to `wrangler deploy` alone. It reads those two from `~/.config/stakeward/secrets.env` (`--secrets-file` to change) and refuses a shell that has exported that file, so never source it. `--dry-run` does everything but the upload; `pnpm deploy:dev --help` lists the options.

Each deploy appends its commit, the Cloudflare version id and the sha256 of every site file to [docs/deploys.md](docs/deploys.md); commit that file. Then check the live site against the commit: `pnpm verify-deploy --env <dev|prod> --commit <sha>` builds the commit again in a temporary worktree, compares every file with what the site serves, and checks that every response carries the security headers of the build's `_headers` (the CSP and the rest) unchanged.

`pnpm deploy:dev:raw` is the old unchecked dev deploy, kept for emergencies; prod has no such route. Deploys are manual: CI has no Cloudflare token, and it only dry-runs the prod config. Roll back with `pnpm exec wrangler rollback --env <env>` in `apps/worker`.

- Secrets: `RPC_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_CHAT_ID`, `TELEGRAM_BOT_USERNAME`, `SITE_ORIGIN`, and optionally `RPC_FALLBACK_URL`. `apps/worker/wrangler.jsonc` describes each. The first deploy of a new worker must pass them all: `pnpm exec wrangler deploy --env dev --secrets-file .dev.vars.dev` in `apps/worker`. Locally they live in `apps/worker/.dev.vars.<env>`, which is gitignored.
- `RPC_URL` must be a private RPC such as Helius: public Solana RPC endpoints refuse requests from Cloudflare Workers.
- Migrations: `pnpm --filter @stakeward/worker db:migrate:dev` or `db:migrate:prod`. To run the worker locally: `pnpm build`, then `pnpm --filter @stakeward/worker exec wrangler d1 migrations apply DB --local --env dev`, then `pnpm --filter @stakeward/worker dev`.
- The monitor fits the Workers Free plan in small batches (`MONITOR_PLAN` = `free`); the paid plan allows bigger passes (`paid`).
- The Telegram webhook registration, the manual checks and the release steps are in [docs/TESTPLAN.md](docs/TESTPLAN.md). The current deployment, its decisions and the reasons behind them are in [docs/DECISIONS.md](docs/DECISIONS.md), section "Развёртывание" and D84.

## License

MIT, see [LICENSE](LICENSE).

No warranty. Stakeward is provided as is. You are responsible for your keys and your stake: try every step on devnet and with a small stake first.
