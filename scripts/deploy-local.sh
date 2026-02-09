#!/usr/bin/env bash
# ------------------------------------------------------------------
# deploy-local.sh
#
# Copy the current plugin source into the local Signal K instance
# (mounted by docker-compose) so changes can be tested without a
# full npm install / reinstall cycle.
#
# Usage:  ./scripts/deploy-local.sh
#
# After running, restart the Signal K container:
#   docker compose restart signalk
# ------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TARGET="$PROJECT_DIR/signalk/node_modules/signalk-cruisereport"

if [ ! -d "$TARGET" ]; then
  echo "ERROR: Target not found: $TARGET"
  echo "       Is the plugin installed in the Signal K instance?"
  exit 1
fi

echo "Deploying plugin to $TARGET ..."

# Plugin server-side code
cp -R "$PROJECT_DIR/plugin/"  "$TARGET/plugin/"

# Built webapp (run 'npm run build' first if you changed src/)
cp -R "$PROJECT_DIR/public/"  "$TARGET/public/"

# Schema files
cp -R "$PROJECT_DIR/schema/"  "$TARGET/schema/"

# Package metadata
cp    "$PROJECT_DIR/package.json" "$TARGET/package.json"

echo "Done.  Restart the container to pick up changes:"
echo "  docker compose restart signalk"
