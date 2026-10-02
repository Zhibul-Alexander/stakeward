#!/usr/bin/env bash
# Chromium for Playwright needs system libraries that minimal images lack. Where `sudo playwright install-deps`
# is impossible (sandboxes, no root), this downloads the Ubuntu 24.04 packages without installing them, unpacks them
# into .cache/pw-libs (gitignored) and prints the LD_LIBRARY_PATH to run Playwright with. CI does not need it:
# it runs `playwright install --with-deps chromium`.
#
#   scripts/playwright-local-libs.sh
#   export LD_LIBRARY_PATH=...   # the line it prints
#   pnpm --filter @stakeward/web exec playwright install chromium   # browser binaries, once
#   pnpm e2e
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/.cache/pw-libs"
PACKAGES=(
  libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libxcomposite1 libxdamage1 libxfixes3 libxrandr2
  libxrender1 libxi6 libgbm1 libasound2t64
)

mkdir -p "$DEST/debs" "$DEST/root"
(cd "$DEST/debs" && apt-get download "${PACKAGES[@]}")
for deb in "$DEST"/debs/*.deb; do
  dpkg -x "$deb" "$DEST/root"
done

echo "export LD_LIBRARY_PATH=$DEST/root/usr/lib/x86_64-linux-gnu\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
