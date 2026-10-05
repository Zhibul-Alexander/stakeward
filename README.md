# Stakeward

Stakeward protects natively staked SOL with the lockup that is built into the Solana stake program. You set a lockup on your existing stake accounts and make a second wallet that you control its custodian; after that, a thief who gets your main key cannot withdraw the stake or reassign it, and you can move it to a new wallet with both keys. Stakeward is non-custodial: it never holds funds or keys, every transaction is built in your browser and signed by your own wallets, and it deploys no on-chain program of its own.

Work in progress. Not ready for use yet.

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

The thief cannot take your SOL, but they can move the lock date or hand the lock to their own key, and freeze the stake. Act first: hand the lock to a new second key. The old second key and the new one both sign; the new one pays, because a stolen key must never pay. The end time stays the same.

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

---

No warranty. Released under the [MIT license](LICENSE).
