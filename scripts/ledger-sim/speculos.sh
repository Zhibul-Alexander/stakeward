#!/usr/bin/env bash
# Builds the Ledger Solana app from source and starts it in the Speculos emulator, for `pnpm ledger-sim`.
# Linux only. Needs: gcc-arm-none-eabi libnewlib-arm-none-eabi clang lld qemu-user-static (apt), git, python3.
# Everything goes into .cache/ledger-sim (git-ignored). Speculos uses its public test seed: never a real key.
#   scripts/ledger-sim/speculos.sh          build if needed, then run Speculos in the foreground
#   MODEL=nanox scripts/ledger-sim/speculos.sh
set -euo pipefail

APP_SOLANA_REF=22d6c9b78d6721acdc6d0ce49788a2fd9ea409a0 # LedgerHQ/app-solana develop, app 1.15.2 (10.10.2026)
SDK_REF=v27.1.2                                          # LedgerHQ/ledger-secure-sdk, API level 27
SPECULOS_VERSION=0.27.1
MODEL=${MODEL:-nanosp}
API_PORT=${API_PORT:-5000}

case "$MODEL" in
  nanosp) TARGET=nanos2 ;;
  nanox) TARGET=nanox ;;
  *) echo "MODEL must be nanosp or nanox (the button devices this driver knows)" >&2; exit 1 ;;
esac

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK="$ROOT/.cache/ledger-sim"
mkdir -p "$WORK"
cd "$WORK"

if [ ! -x venv/bin/speculos ]; then
  python3 -m venv venv
  venv/bin/pip install -q "speculos==$SPECULOS_VERSION" pillow ledgered
fi

fetch() { # dir url ref
  if [ ! -d "$1/.git" ]; then git init -q "$1" && git -C "$1" remote add origin "$2"; fi
  git -C "$1" fetch -q --depth 1 origin "$3" && git -C "$1" checkout -q FETCH_HEAD
}

ELF="$WORK/solana-$MODEL.elf"
if [ ! -f "$ELF" ]; then
  fetch ledger-secure-sdk https://github.com/LedgerHQ/ledger-secure-sdk "$SDK_REF"
  fetch app-solana https://github.com/LedgerHQ/app-solana "$APP_SOLANA_REF"
  # The final .apdu step needs ledgerblue; the ELF is built before it, so its failure is ignored.
  (cd app-solana && PATH="$WORK/venv/bin:$PATH" make -j"$(nproc)" BOLOS_SDK="$WORK/ledger-secure-sdk" TARGET="$TARGET" >build.log 2>&1 || true)
  cp "app-solana/build/$TARGET/bin/app.elf" "$ELF"
fi

echo "Speculos $MODEL on http://127.0.0.1:$API_PORT (Ctrl+C to stop)"
exec venv/bin/speculos --model "$MODEL" --display headless --api-port "$API_PORT" --apdu-port 0 "$ELF"
