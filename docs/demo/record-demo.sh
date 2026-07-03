#!/bin/bash

# Records the demo with a clean prompt and a self-contained inup binary,
# so the recording does not depend on global pnpm link / PATH propagation
# into the VHS-spawned shell.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEMO_PROJECT_DIR="$REPO_ROOT/docs/demo-project"
TEMP_DIR="/tmp/my-app"
TAPE_FILE="$REPO_ROOT/docs/demo/demo-real.tape"
CLI_ENTRY="$REPO_ROOT/dist/cli.js"
WRAPPER_BIN_DIR="$TEMP_DIR/.bin"

echo "Recording demo with clean paths..."

echo "Building CLI..."
( cd "$REPO_ROOT" && pnpm build )

echo "Installing demo-project dependencies..."
( cd "$DEMO_PROJECT_DIR" && pnpm install --prefer-offline )

echo "Setting up temporary demo directory..."
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR" "$WRAPPER_BIN_DIR"
# Copy the whole monorepo (pnpm-workspace.yaml with catalogs + member packages),
# not just the root package.json — the demo shows workspace + catalog support.
rsync -a --exclude node_modules "$DEMO_PROJECT_DIR/" "$TEMP_DIR/"

# Wrapper script invokes the freshly built CLI directly — no pnpm link needed.
cat > "$WRAPPER_BIN_DIR/inup" <<EOF
#!/usr/bin/env bash
exec node "$CLI_ENTRY" "\$@"
EOF
chmod +x "$WRAPPER_BIN_DIR/inup"

# Prepend wrapper dir so VHS's shell sees inup on PATH.
export PATH="$WRAPPER_BIN_DIR:$PATH"

cleanup() {
    echo "Cleaning up..."
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "Recording with vhs..."
vhs "$TAPE_FILE"

echo "Demo recorded: docs/demo/interactive-upgrade.gif"
