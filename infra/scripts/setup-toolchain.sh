#!/usr/bin/env bash
# Installs the toolchains On-Chain Arbitrage Lab needs, all in user space
# (no sudo). Safe to re-run; each installer is idempotent.
set -euo pipefail

echo "==> [1/4] Node.js 20 via nvm"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -d "$NVM_DIR" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 20
nvm alias default 20
nvm use 20
echo "    node $(node -v), npm $(npm -v)"

echo "==> [2/4] pnpm via corepack"
corepack enable
corepack prepare pnpm@10.18.0 --activate
echo "    pnpm $(pnpm -v)"

echo "==> [3/4] Rust via rustup"
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
# shellcheck disable=SC1091
[ -s "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
echo "    $(rustc --version)"

echo "==> [4/4] Foundry via foundryup"
export PATH="$HOME/.foundry/bin:$PATH"
if ! command -v forge >/dev/null 2>&1; then
  curl -L https://foundry.paradigm.xyz | bash
  foundryup
fi
echo "    $(forge --version | head -1)"

echo
echo "All toolchains ready. Add these to your shell rc if not already:"
echo '  export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"'
echo '  . "$HOME/.cargo/env"'
echo '  export PATH="$HOME/.foundry/bin:$PATH"'
