#!/usr/bin/env bash
# Stakeward live demo in the terminal: the lock on a native stake account, driven with the stock Solana CLI.
# Every action is one `solana` command; the script prints it, runs it and says in plain words what the network did.
# Keys are local keypair files of throwaway demo wallets (.keys/live-demo/, gitignored), never seed phrases.
# Usage: scripts/live-demo/sw.sh help. Works with bash 3.2 (macOS) and newer.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SW_DIR="${SW_DIR:-$REPO_DIR/.keys/live-demo}"
# demo.env sets SW_* only where the caller's environment has not set them already.
if [ -f "$SW_DIR/demo.env" ]; then
  # shellcheck disable=SC1091
  . "$SW_DIR/demo.env"
fi
SW_URL="${SW_URL:-devnet}"
SW_MAIN_KEY="${SW_MAIN_KEY:-$SW_DIR/main.json}"
SW_SECOND_KEY="${SW_SECOND_KEY:-$SW_DIR/second.json}"
SW_NEW_KEY="${SW_NEW_KEY:-$SW_DIR/new.json}"
SW_THIEF_KEY="${SW_THIEF_KEY:-$SW_DIR/thief.json}"
SW_FUNDER_KEY="${SW_FUNDER_KEY:-}"
SW_VOTE="${SW_VOTE:-}"
SW_ONCHAIN_FAILS="${SW_ONCHAIN_FAILS:-1}"

# The Solana CLI: PATH, then $SOLANA_BIN, then the default install location of the Anza installer.
for dir in "${SOLANA_BIN:-}" "$HOME/.local/share/solana/install/active_release/bin"; do
  if ! command -v solana >/dev/null 2>&1 && [ -n "$dir" ] && [ -x "$dir/solana" ]; then PATH="$dir:$PATH"; fi
done

# ---- Output ----

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; D=$'\033[2m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; M=$'\033[35m'; N=$'\033[0m'
else
  B=''; D=''; R=''; G=''; Y=''; C=''; M=''; N=''
fi

die() { printf '%s\n' "${R}${B}$*${N}" >&2; exit 1; }
info() { printf '%s\n' "${D}$*${N}"; }

# Actor banner: who acts and what they try.
say() {
  local who="$1" what="$2" color
  case "$who" in
    THIEF*) color="$R" ;;
    "SECOND KEY"*) color="$M" ;;
    "NEW WALLET"*) color="$C" ;;
    *) color="$G" ;;
  esac
  printf '\n%s\n' "${B}${color}▶ ${who}${N}${B}  ${what}${N}"
}

addr() { solana-keygen pubkey "$1" 2>/dev/null; }
short() { local a="$1"; printf '%s…%s' "${a:0:4}" "${a: -4}"; }

cluster_param() {
  case "$SW_URL" in
    devnet | d | *devnet*) printf '?cluster=devnet' ;;
    testnet | t | *testnet*) printf '?cluster=testnet' ;;
    mainnet-beta | m | *mainnet*) printf '' ;;
    *) printf '?cluster=custom&customUrl=%s' "http://127.0.0.1:8899" ;;
  esac
}

# Role names instead of addresses, so the projector shows "MAIN KEY" rather than 44 characters.
label_sed() {
  local role file a script=''
  for role in MAIN SECOND NEW THIEF; do
    file="$(key_file "$role")"
    [ -f "$file" ] || continue
    a="$(addr "$file")"
    [ -n "$a" ] && script="${script}s/${a}/${a} [$(role_name "$role")]/g;"
  done
  printf '%s' "$script"
}

role_name() {
  case "$1" in
    MAIN) echo 'MAIN KEY' ;; SECOND) echo 'SECOND KEY' ;; NEW) echo 'NEW WALLET' ;; THIEF) echo 'THIEF' ;;
  esac
}

key_file() {
  case "$1" in
    MAIN | main) echo "$SW_MAIN_KEY" ;;
    SECOND | second) echo "$SW_SECOND_KEY" ;;
    NEW | new) echo "$SW_NEW_KEY" ;;
    THIEF | thief) echo "$SW_THIEF_KEY" ;;
    FUNDER | funder) echo "$SW_FUNDER_KEY" ;;
    *) return 1 ;;
  esac
}

need_key() {
  local file
  file="$(key_file "$1")" || die "Unknown role: $1 (main, second, new, thief)"
  [ -n "$file" ] && [ -f "$file" ] || die "No $(role_name "$1") keypair at '${file}'. Run: sw setup"
  printf '%s' "$file"
}

# ---- The current stake account ----

stake_address() {
  if [ -n "${SW_STAKE:-}" ]; then printf '%s' "$SW_STAKE"; return; fi
  [ -f "$SW_DIR/current-stake" ] || die "No stake account yet. Run: sw stake 0.1"
  cat "$SW_DIR/current-stake"
}

# One field of `solana stake-account --output json-compact`; empty when absent.
stake_field() {
  printf '%s' "$1" | grep -o "\"$2\":[^,}]*" | head -1 | cut -d: -f2 | tr -d '"'
}

stake_json() {
  solana stake-account "$1" --url "$SW_URL" --output json-compact 2>/dev/null
}

fmt_date() {
  # RFC 3339 UTC of a unix time, on GNU date and BSD (macOS) date.
  date -u -d "@$1" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -r "$1" '+%Y-%m-%dT%H:%M:%SZ'
}

human_date() {
  date -u -d "@$1" '+%d %b %Y %H:%M UTC' 2>/dev/null || date -u -r "$1" '+%d %b %Y %H:%M UTC'
}

lock_until() {
  local json ts
  json="$(stake_json "$(stake_address)")"
  ts="$(stake_field "$json" unixTimestamp)"
  if [ -n "$ts" ] && [ "$ts" -gt "$(date +%s)" ]; then human_date "$ts"; fi
}

# ---- Running a transaction ----

# run <expect: ok|fail> <plain reason shown on rejection, may be empty> -- solana args...
# Prints the command with role names, runs it, prints ACCEPTED or REJECTED and the explorer link.
run() {
  local expect="$1" reason="$2" out status sig labels shown f r
  shift 3
  labels="$(label_sed)"
  shown="solana $*"
  for f in "$SW_MAIN_KEY" "$SW_SECOND_KEY" "$SW_NEW_KEY" "$SW_THIEF_KEY" "$SW_FUNDER_KEY"; do
    [ -n "$f" ] || continue
    case "$f" in "$SW_MAIN_KEY") r=main ;; "$SW_SECOND_KEY") r=second ;; "$SW_NEW_KEY") r=new ;; "$SW_THIEF_KEY") r=thief ;; *) r=funder ;; esac
    shown="${shown//"$f"/\$${r}.json}"
  done
  shown="${shown//"$SW_DIR"\//}"
  printf '%s\n' "${D}\$ ${shown}${N}"
  out="$(solana "$@" --url "$SW_URL" 2>&1)"
  status=$?
  sig="$(printf '%s\n' "$out" | grep -oE '(Signature: |^)[1-9A-HJ-NP-Za-km-z]{80,90}$' | tail -1 | sed 's/^Signature: //')"
  if [ $status -eq 0 ]; then
    printf '%s\n' "$out" | grep -v '^Signature' | sed "$labels" | sed "s/^/  ${D}/;s/\$/${N}/" | grep -v "^  ${D}${N}\$" || true
    if [ "$expect" = ok ]; then
      printf '%s\n' "${G}${B}✅ ACCEPTED by Solana${N}"
    else
      printf '%s\n' "${Y}${B}⚠ ACCEPTED by Solana (this was expected to fail)${N}"
    fi
  else
    printf '%s\n' "$out" | grep -E 'Error|error' | head -2 | sed "$labels" | sed "s/^/  ${D}/;s/\$/${N}/"
    case "$out" in
      # The CLI read the stake account and refused to build the transaction: nothing was sent.
      *'RPC request error: Invalid authority'*)
        printf '%s\n' "${R}${B}⛔ REJECTED: $(explain "$out" "$reason")${N} ${D}(the CLI read the account on chain and did not send)${N}" ;;
      *) printf '%s\n' "${R}${B}⛔ REJECTED by Solana: $(explain "$out" "$reason")${N}" ;;
    esac
  fi
  # A transaction sent with --skip-preflight failed on chain: its signature is the fee payer's latest one.
  if [ $status -ne 0 ] && [ -z "$sig" ] && [ "$SW_ONCHAIN_FAILS" = 1 ] && [ -n "${RUN_PAYER:-}" ]; then
    case "$out" in
      *'simulation failed'* | *'RPC request error'*) ;;
      *) sig="$(solana transaction-history "$(addr "$RUN_PAYER")" --limit 1 --url "$SW_URL" --output json-compact \
        2>/dev/null | grep -o '"signature":"[^"]*"' | head -1 | cut -d'"' -f4)"
        [ -n "$sig" ] && printf '%s\n' "${D}  failed transaction, recorded on chain:${N}" ;;
    esac
  fi
  if [ -n "$sig" ]; then
    printf '%s\n' "${D}  https://explorer.solana.com/tx/${sig}$(cluster_param)${N}"
  fi
  if [ "$expect" = ok ]; then return $status; fi
  [ $status -ne 0 ]
}

# Plain words for the stake program errors the demo meets (the same table as the site, CLAUDE.md section 9).
explain() {
  local out="$1" reason="$2" until
  if [ -n "$reason" ]; then printf '%s' "$reason"; return; fi
  case "$out" in
    *'lockup has not yet expired'*)
      until="$(lock_until)"
      printf 'Locked%s: the second key must co-sign' "${until:+ until $until}" ;;
    *'custodian address not present'*) printf 'changing the owner needs the second key' ;;
    *'missing required signature'*)
      if [ "$(stake_field "$(stake_json "$(stake_address)")" withdrawer)" != "$(addr "$SW_MAIN_KEY")" ]; then
        printf 'the main key no longer owns this stake'
      else
        printf 'a required key did not sign'
      fi ;;
    *'Invalid authority'* | *'incorrect authority'*) printf 'this key is not the owner of the stake' ;;
    *'insufficient funds for fee'*) printf 'the fee payer has no SOL. Run: sw fund' ;;
    *'insufficient funds for instruction'*) printf 'the stake is still active: unstake, then wait for the epoch to end' ;;
    *'epoch rewards period'*) printf 'epoch rewards are being paid right now; try again in a minute' ;;
    *'Blockhash not found'* | *'block height exceeded'*) printf 'the network was slow; run the same command again' ;;
    *) printf '%s' "$(printf '%s\n' "$out" | grep -m1 -i 'error' | sed 's/^Error: //')" ;;
  esac
}

# Thief transactions land on chain when SW_ONCHAIN_FAILS=1, so the failed transaction shows in the explorer.
thief_flags() {
  if [ "$SW_ONCHAIN_FAILS" = 1 ]; then printf '%s' '--skip-preflight'; fi
}

# ---- Durations ----

# 10m, 2h, 3d, 6mo or an RFC 3339 date -> unix time.
lock_time() {
  local spec="$1" now n
  now="$(date +%s)"
  case "$spec" in
    *[0-9]mo) n="${spec%mo}"; echo $((now + n * 30 * 86400)) ;;
    *[0-9]m) n="${spec%m}"; echo $((now + n * 60)) ;;
    *[0-9]h) n="${spec%h}"; echo $((now + n * 3600)) ;;
    *[0-9]d) n="${spec%d}"; echo $((now + n * 86400)) ;;
    *T*Z)
      date -u -d "$spec" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$spec" +%s 2>/dev/null \
        || die "Cannot read the date $spec" ;;
    *) die "Lock duration: 10m, 2h, 3d, 6mo or a date like 2027-04-11T00:00:00Z" ;;
  esac
}

# ---- Commands ----

cmd_setup() {
  command -v solana-keygen >/dev/null 2>&1 \
    || die "Solana CLI not found. Install it (https://docs.anza.xyz/cli/install) or set SOLANA_BIN."
  mkdir -p "$SW_DIR"
  chmod 700 "$SW_DIR"
  local role file
  for role in main second new thief; do
    file="$SW_DIR/$role.json"
    if [ -f "$file" ]; then
      info "$(role_name "$(echo "$role" | tr a-z A-Z)"): keeps $file"
    else
      solana-keygen new --no-bip39-passphrase --silent --outfile "$file" >/dev/null || die "keygen failed"
      chmod 600 "$file"
      info "$(role_name "$(echo "$role" | tr a-z A-Z)"): new demo key $file"
    fi
  done
  if [ ! -f "$SW_DIR/demo.env" ]; then
    cat > "$SW_DIR/demo.env" <<EOF
# Stakeward live demo. Throwaway devnet keys; never put a real wallet here.
# Each line keeps a value already set in the environment.
export SW_URL="\${SW_URL:-devnet}"
export SW_MAIN_KEY="\${SW_MAIN_KEY:-$SW_DIR/main.json}"
export SW_SECOND_KEY="\${SW_SECOND_KEY:-$SW_DIR/second.json}"
export SW_NEW_KEY="\${SW_NEW_KEY:-$SW_DIR/new.json}"
export SW_THIEF_KEY="\${SW_THIEF_KEY:-$SW_DIR/thief.json}"
# A keypair file with devnet SOL that pays for "sw fund" (empty = airdrop).
export SW_FUNDER_KEY="\${SW_FUNDER_KEY:-}"
# Validator vote account for "sw delegate" (empty = the largest devnet validator).
export SW_VOTE="\${SW_VOTE:-}"
# 1 = the thief's failing transactions land on chain and get an explorer link; 0 = only simulated (faster).
export SW_ONCHAIN_FAILS="\${SW_ONCHAIN_FAILS:-1}"
EOF
    chmod 600 "$SW_DIR/demo.env"
    info "settings: $SW_DIR/demo.env"
  fi
  cmd_keys
}

cmd_keys() {
  local role file
  printf '%s\n' "${B}Demo keys on ${SW_URL}${N}"
  for role in MAIN SECOND NEW THIEF; do
    file="$(key_file "$role")"
    if [ -f "$file" ]; then
      printf '  %-11s %s\n' "$(role_name "$role")" "$(addr "$file")"
    else
      printf '  %-11s %s\n' "$(role_name "$role")" "${R}missing: $file${N}"
    fi
  done
  if [ -n "$SW_FUNDER_KEY" ] && [ -f "$SW_FUNDER_KEY" ]; then printf '  %-11s %s\n' 'FUNDER' "$(addr "$SW_FUNDER_KEY")"; fi
  if [ -f "$SW_DIR/current-stake" ]; then printf '  %-11s %s\n' 'STAKE' "$(cat "$SW_DIR/current-stake")"; fi
}

cmd_balances() {
  local role file a
  printf '%s\n' "${B}Wallet balances on ${SW_URL}${N}"
  for role in MAIN SECOND NEW THIEF; do
    file="$(key_file "$role")"
    [ -f "$file" ] || continue
    a="$(addr "$file")"
    printf '  %-11s %-20s %s\n' "$(role_name "$role")" "$(short "$a")" "$(solana balance "$a" --url "$SW_URL" 2>&1)"
  done
  if [ -f "$SW_DIR/current-stake" ] || [ -n "${SW_STAKE:-}" ]; then
    a="$(stake_address)"
    printf '  %-11s %-20s %s\n' 'STAKE' "$(short "$a")" "$(solana balance "$a" --url "$SW_URL" 2>&1)"
  fi
}

# fund [SOL]: sends SOL (default 0.05) to every demo wallet from the funder, or by airdrop.
cmd_fund() {
  local amount="${1:-0.05}" role file a
  for role in main second new thief; do
    file="$(need_key "$role")"
    a="$(addr "$file")"
    if [ -n "$SW_FUNDER_KEY" ]; then
      say 'FUNDER' "sends ${amount} SOL to $(role_name "$(echo "$role" | tr a-z A-Z)")"
      run ok '' -- transfer "$a" "$amount" --from "$SW_FUNDER_KEY" --fee-payer "$SW_FUNDER_KEY" \
        --allow-unfunded-recipient || return 1
    else
      say 'FAUCET' "airdrops ${amount} SOL to $(role_name "$(echo "$role" | tr a-z A-Z)")"
      run ok '' -- airdrop "$amount" "$a" || info "  The devnet faucet limits airdrops. Set SW_FUNDER_KEY or use https://faucet.solana.com"
    fi
  done
}

# transfer <from role> <to role or address> <SOL|ALL>
cmd_transfer() {
  [ $# -eq 3 ] || die "Usage: sw transfer <from: main|second|new|thief> <to: role or address> <SOL|ALL>"
  local from to dest
  from="$(need_key "$1")"
  if to="$(key_file "$2" 2>/dev/null)" && [ -f "$to" ]; then dest="$(addr "$to")"; else dest="$2"; fi
  say "$(role_name "$(echo "$1" | tr a-z A-Z)")" "sends $3 SOL to $(who "$dest")"
  run ok '' -- transfer "$dest" "$3" --from "$from" --fee-payer "$from" --allow-unfunded-recipient
}

# stake <SOL>: a new stake account, main key = staker = withdrawer, no lock. Becomes the current stake.
cmd_stake() {
  local amount="${1:-0.1}" main file a
  main="$(need_key main)"
  file="$SW_DIR/stake-$(date +%Y%m%d-%H%M%S).json"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$file" >/dev/null || die "keygen failed"
  a="$(addr "$file")"
  say 'MAIN KEY' "puts ${amount} SOL into a new stake account $(short "$a")"
  if run ok '' -- create-stake-account "$file" "$amount" \
    --stake-authority "$main" --withdraw-authority "$main" --from "$main" --fee-payer "$main"; then
    printf '%s' "$a" > "$SW_DIR/current-stake"
    info "  current stake: $a"
  fi
}

pick_vote() {
  if [ -n "$SW_VOTE" ]; then printf '%s' "$SW_VOTE"; return; fi
  # The validator with the most active stake: on devnet that one is reliably up.
  solana validators --url "$SW_URL" --sort stake --reverse --output json-compact 2>/dev/null \
    | grep -o '"voteAccountPubkey":"[^"]*"' | head -1 | cut -d'"' -f4
}

cmd_delegate() {
  local main vote
  main="$(need_key main)"
  vote="$(pick_vote)"
  [ -n "$vote" ] || die "No validator found. Set SW_VOTE to a vote account."
  say 'MAIN KEY' "delegates the stake to validator $(short "$vote")"
  run ok '' -- delegate-stake "$(stake_address)" "$vote" --stake-authority "$main" --fee-payer "$main"
}

# lock [10m|2h|3d|6mo|date]: what Stakeward's Protect does. Main key sets the lock, second key becomes its holder.
cmd_lock() {
  local spec="${1:-6mo}" main second t
  main="$(need_key main)"
  second="$(need_key second)"
  t="$(lock_time "$spec")"
  say 'MAIN KEY + SECOND KEY' "lock the stake until $(human_date "$t"); the second key holds the lock"
  run ok '' -- stake-set-lockup-checked "$(stake_address)" --lockup-date "$(fmt_date "$t")" \
    --custodian "$main" --new-custodian "$second" --fee-payer "$main"
}

cmd_status() {
  local a json ts now staker withdrawer custodian deact
  a="$(stake_address)"
  printf '\n%s\n' "${B}Stake account ${a}${N}"
  solana stake-account "$a" --url "$SW_URL" 2>&1 | grep -v '^ *$' | sed "$(label_sed)" | sed 's/^/  /'
  json="$(stake_json "$a")"
  [ -n "$json" ] || return 0
  now="$(date +%s)"
  ts="$(stake_field "$json" unixTimestamp)"
  staker="$(stake_field "$json" staker)"
  withdrawer="$(stake_field "$json" withdrawer)"
  custodian="$(stake_field "$json" custodian)"
  deact="$(stake_field "$json" deactivationEpoch)"
  printf '%s' "  ${B}In plain words:${N} "
  if [ -n "$ts" ] && [ "$ts" -gt "$now" ]; then
    printf '%s\n' "${G}${B}🔒 PROTECTED until $(human_date "$ts")${N}, second key: $(who "$custodian")"
  else
    printf '%s\n' "${Y}${B}🔓 NOT LOCKED${N}: whoever has the main key can take it"
  fi
  printf '%s\n' "  owner (withdraw): $(who "$withdrawer");  manager (stake): $(who "$staker")${deact:+;  unstaking since epoch $deact}"
}

who() {
  local role file
  for role in MAIN SECOND NEW THIEF; do
    file="$(key_file "$role")"
    if [ -f "$file" ] && [ "$(addr "$file")" = "$1" ]; then printf '%s' "${B}$(role_name "$role")${N}"; return; fi
  done
  printf '%s' "$(short "${1:-none}")"
}

# unstake [main|new]: Deactivate, signed by the stake manager.
cmd_unstake() {
  local role="${1:-main}" key
  key="$(need_key "$role")"
  say "$(role_name "$(echo "$role" | tr a-z A-Z)")" "unstakes (deactivates) the stake"
  run ok '' -- deactivate-stake "$(stake_address)" --stake-authority "$key" --fee-payer "$key"
}

# withdraw [SOL|ALL]: main key + second key take the SOL out to the main wallet.
cmd_withdraw() {
  local amount="${1:-ALL}" main second
  main="$(need_key main)"
  second="$(need_key second)"
  say 'MAIN KEY + SECOND KEY' "withdraw ${amount} SOL to the main wallet"
  run ok '' -- withdraw-stake "$(stake_address)" "$(addr "$main")" "$amount" \
    --withdraw-authority "$main" --custodian "$second" --fee-payer "$main"
}

# extend <duration>: the second key alone moves the end date (and pays).
cmd_extend() {
  local spec="${1:-6mo}" second t
  second="$(need_key second)"
  t="$(lock_time "$spec")"
  say 'SECOND KEY' "moves the lock end to $(human_date "$t")"
  run ok '' -- stake-set-lockup "$(stake_address)" --lockup-date "$(fmt_date "$t")" \
    --custodian "$second" --fee-payer "$second"
}

# unlock: the second key ends the lock now.
cmd_unlock() {
  local second
  second="$(need_key second)"
  say 'SECOND KEY' "removes the lock early"
  run ok '' -- stake-set-lockup "$(stake_address)" --lockup-date 1970-01-01T00:00:00Z \
    --custodian "$second" --fee-payer "$second"
}

# rescue: main + second + new wallet move both authorities to the new wallet; the new wallet pays.
cmd_rescue() {
  local main second new
  main="$(need_key main)"
  second="$(need_key second)"
  new="$(need_key new)"
  say 'NEW WALLET + MAIN KEY + SECOND KEY' "rescue: the stake now belongs to the NEW WALLET (the lock stays)"
  run ok '' -- stake-authorize-checked "$(stake_address)" \
    --stake-authority "$main" --withdraw-authority "$main" \
    --new-stake-authority "$new" --new-withdraw-authority "$new" \
    --custodian "$second" --fee-payer "$new"
}

# withdraw-new [SOL|ALL]: after a rescue, the new wallet + second key withdraw to the new wallet.
cmd_withdraw_new() {
  local amount="${1:-ALL}" new second
  new="$(need_key new)"
  second="$(need_key second)"
  say 'NEW WALLET + SECOND KEY' "withdraw ${amount} SOL to the new wallet"
  run ok '' -- withdraw-stake "$(stake_address)" "$(addr "$new")" "$amount" \
    --withdraw-authority "$new" --custodian "$second" --fee-payer "$new"
}

# thief <action>: the thief holds a stolen copy of the main key and pays fees from their own wallet.
cmd_thief() {
  local action="${1:-}" main thief stake extra
  main="$(need_key main)"
  thief="$(need_key thief)"
  stake="$(stake_address)"
  extra="$(thief_flags)"
  RUN_PAYER="$thief"
  case "$action" in
    withdraw)
      say 'THIEF (stolen MAIN KEY)' "tries: withdraw all SOL to the thief's wallet"
      # shellcheck disable=SC2086
      run fail '' -- withdraw-stake "$stake" "$(addr "$thief")" ALL \
        --withdraw-authority "$main" --fee-payer "$thief" $extra ;;
    take)
      say 'THIEF (stolen MAIN KEY)' "tries: make the thief the owner of the stake"
      # shellcheck disable=SC2086
      run fail '' -- stake-authorize-checked "$stake" --withdraw-authority "$main" \
        --new-withdraw-authority "$thief" --fee-payer "$thief" $extra ;;
    unlock)
      say 'THIEF (stolen MAIN KEY)' "tries: remove the lock"
      # shellcheck disable=SC2086
      run fail 'only the second key can change the lock while it is on' -- stake-set-lockup "$stake" \
        --lockup-date 1970-01-01T00:00:00Z --custodian "$main" --fee-payer "$thief" $extra ;;
    unstake)
      # Whichever of the two the thief controls is the stake manager now.
      local signer="$main"
      if [ "$(stake_field "$(stake_json "$stake")" staker)" = "$(addr "$thief")" ]; then signer="$thief"; fi
      say 'THIEF (stolen MAIN KEY)' "unstakes: the main key alone can do that"
      run ok '' -- deactivate-stake "$stake" --stake-authority "$signer" --fee-payer "$thief" \
        && info "  The SOL stays in the stake account; Stakeward sends an alert. Next: sw rescue" ;;
    staker)
      say 'THIEF (stolen MAIN KEY)' "takes over staking (the stake manager role): the main key alone can do that"
      run ok '' -- stake-authorize-checked "$stake" --stake-authority "$main" \
        --new-stake-authority "$thief" --fee-payer "$thief" \
        && info "  Still cannot withdraw. The rescue works anyway: the main key is still the owner." ;;
    all)
      cmd_thief withdraw
      cmd_thief take
      cmd_thief unlock ;;
    *) die "Usage: sw thief withdraw | take | unlock | unstake | staker | all" ;;
  esac
}

# sweep: send what is left on the demo wallets back to the funder.
cmd_sweep() {
  [ -n "$SW_FUNDER_KEY" ] && [ -f "$SW_FUNDER_KEY" ] || die "Set SW_FUNDER_KEY to return the SOL to it."
  local role file
  for role in main second new thief; do
    file="$(key_file "$role")"
    [ -f "$file" ] || continue
    say "$(role_name "$(echo "$role" | tr a-z A-Z)")" "returns its SOL to the funder"
    run ok '' -- transfer "$(addr "$SW_FUNDER_KEY")" ALL --from "$file" --fee-payer "$file" || true
  done
}

cmd_help() {
  cat <<EOF
${B}Stakeward live demo${N} (${SW_URL}). Keys: ${SW_DIR}

${B}Prepare${N}
  sw setup                  create the demo keys (main, second, new, thief) and demo.env
  sw keys | sw balances     addresses / balances (role names, not addresses)
  sw fund [SOL]             send SOL to every demo wallet (from SW_FUNDER_KEY, else airdrop)
  sw transfer <from> <to> <SOL|ALL>   e.g. sw transfer main new 0.02

${B}Owner${N}
  sw stake [SOL]            new stake account (main key owns it, no lock); becomes current
  sw delegate               stake it with a validator (devnet needs at least 1 SOL)
  sw lock [10m|2h|6mo|date] PROTECT: main + second key lock it; second key holds the lock
  sw status                 the stake account, in plain words
  sw unstake                deactivate (main key)
  sw withdraw [SOL|ALL]     main + second key take the SOL out
  sw extend <duration>      second key moves the end date
  sw unlock                 second key ends the lock now

${B}Thief${N} (has a stolen copy of the main key)
  sw thief withdraw         withdraw everything          -> rejected
  sw thief take             make himself the owner       -> rejected
  sw thief unlock           remove the lock              -> rejected
  sw thief all              the three above
  sw thief unstake          deactivate                   -> accepted (SOL stays, alert)
  sw thief staker           take the staking role        -> accepted (rescue still works)

${B}Rescue${N}
  sw rescue                 new wallet + main + second: the stake moves to the NEW WALLET
  sw withdraw-new [SOL|ALL] new wallet + second key withdraw
  sw sweep                  return what is left to SW_FUNDER_KEY

Env: SW_URL (devnet), SW_MAIN_KEY, SW_SECOND_KEY, SW_NEW_KEY, SW_THIEF_KEY, SW_FUNDER_KEY,
     SW_STAKE (another stake account), SW_VOTE, SW_ONCHAIN_FAILS=0 (thief's failures only simulated, no explorer link).
EOF
}

main() {
  command -v solana >/dev/null 2>&1 || [ "${1:-help}" = help ] \
    || die "Solana CLI not found. Install it (https://docs.anza.xyz/cli/install) or set SOLANA_BIN."
  local cmd="${1:-help}"
  [ $# -gt 0 ] && shift
  case "$cmd" in
    setup) cmd_setup ;;
    keys) cmd_keys ;;
    balances | bal) cmd_balances ;;
    fund) cmd_fund "$@" ;;
    transfer) cmd_transfer "$@" ;;
    stake) cmd_stake "$@" ;;
    delegate) cmd_delegate ;;
    lock | protect) cmd_lock "$@" ;;
    status) cmd_status ;;
    unstake) cmd_unstake "$@" ;;
    withdraw) cmd_withdraw "$@" ;;
    extend) cmd_extend "$@" ;;
    unlock) cmd_unlock ;;
    rescue) cmd_rescue ;;
    withdraw-new) cmd_withdraw_new "$@" ;;
    thief) cmd_thief "$@" ;;
    sweep) cmd_sweep ;;
    help | -h | --help) cmd_help ;;
    *) die "Unknown command: $cmd. Run: sw help" ;;
  esac
}

main "$@"
