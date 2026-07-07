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

# Both outputs are required: the README embeds the gif and the website
# hero plays the mp4. Fail before recording rather than after.
for tool in vhs ffmpeg; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "error: $tool is required (brew install $tool)" >&2
        exit 1
    fi
done

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

# The website hero plays the mp4 variant (5x smaller than the gif);
# keep it in sync with every re-recording.
echo "Converting to mp4 for the website..."
ffmpeg -y -i "$REPO_ROOT/docs/demo/interactive-upgrade.gif" \
    -movflags faststart -pix_fmt yuv420p \
    -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -crf 28 -an \
    "$REPO_ROOT/docs/demo/interactive-upgrade.mp4"

echo "Demo recorded: docs/demo/interactive-upgrade.gif (+ .mp4)"
