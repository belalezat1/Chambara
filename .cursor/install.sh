#!/usr/bin/env bash
# Idempotent bootstrap for the Chambara Cloud Agent environment.
# Installs the SpacetimeDB CLI (if missing), frontend deps, backend module deps,
# and builds the backend module so it is ready to publish to the local server.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"

# 1. SpacetimeDB CLI (skip if already present).
if ! command -v spacetime >/dev/null 2>&1; then
  echo "==> Installing SpacetimeDB CLI"
  curl -fsSL https://install.spacetimedb.com | sh -s -- --yes
fi
spacetime --version

# 2. Frontend (Babylon.js + Vite) dependencies.
echo "==> Installing game dependencies"
cd "$REPO_ROOT/game"
npm install

# 3. Backend SpacetimeDB module dependencies + build.
echo "==> Installing and building SpacetimeDB module"
cd "$REPO_ROOT/spacetimedb/spacetimedb"
npm install
cd "$REPO_ROOT/spacetimedb"
spacetime build

echo "==> Install complete"
