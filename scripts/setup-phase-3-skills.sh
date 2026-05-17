#!/usr/bin/env bash
set -Eeuo pipefail

# Installs Phase 3 Skills.sh content skills for the Jonathan Harris ecosystem.
# Repository-side gates are committed separately; this script performs the external Skills.sh install.

run() {
  printf '\n▶ %s\n' "$*"
  DISABLE_TELEMETRY=1 "$@"
}

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to install Skills.sh skills." >&2
  exit 1
fi

run npx --yes skills@latest add https://github.com/coreyhaines31/marketingskills --skill copywriting copy-editing content-strategy product-marketing-context brand-guidelines -y

printf '\n✅ Phase 3 Skills.sh install commands completed. Keep Phase 3 fail-closed gates enabled before allowing automated publication.\n'
