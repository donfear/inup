#!/bin/bash

# Records the demo with a clean prompt and a self-contained inup binary,
# so the recording does not depend on global pnpm link / PATH propagation
# into the VHS-spawned shell.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEMO_PROJECT_DIR="$REPO_ROOT/docs/demo-project"
TAPE_FILE="$REPO_ROOT/docs/demo/demo-real.tape"
CLI_ENTRY="$REPO_ROOT/dist/cli.js"

echo "Recording demo with clean paths..."

# The README embeds the gif. Fail before recording rather than after.
for tool in vhs ffmpeg ffprobe; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "error: $tool is required (brew install $tool)" >&2
        exit 1
    fi
done

# Scratch for the render itself (fresh GIF, palette, throwaway HOME).
# Unique per run so a failed render can never leave a previous GIF behind for
# the conversion steps to pick up and republish as new.
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/inup-demo.XXXXXX")"
# The project inup runs against is separate and deliberately short: inup prints
# resolved absolute paths in its upgrade report, and those are on screen. A
# mktemp path would put the machine's temp layout in the published demo, so
# keep the visible root a plain /tmp. Overridable for tests only.
DEMO_DIR="${DEMO_WORKSPACE_ROOT:-/tmp}/my-app"
cleanup() {
    echo "Cleaning up..."
    rm -rf -- "$TEMP_DIR" "$DEMO_DIR"
}
trap cleanup EXIT
WRAPPER_BIN_DIR="$DEMO_DIR/.bin"
export VHS_DEMO_DIR="$DEMO_DIR"

echo "Building CLI..."
( cd "$REPO_ROOT" && pnpm build )
echo "Recording source: $(git -C "$REPO_ROOT" rev-parse HEAD)"
echo "CLI entry: $CLI_ENTRY"
vhs --version

echo "Installing demo-project dependencies..."
( cd "$DEMO_PROJECT_DIR" && pnpm install --prefer-offline )

echo "Setting up temporary demo directory..."
rm -rf -- "$DEMO_DIR"
mkdir -p "$DEMO_DIR" "$WRAPPER_BIN_DIR"
# Copy the whole monorepo (pnpm-workspace.yaml with catalogs + member packages),
# not just the root package.json — the demo shows workspace + catalog support.
rsync -a --exclude node_modules "$DEMO_PROJECT_DIR/" "$DEMO_DIR/"

# Record with the shipped Default theme, never the maintainer's saved theme.
# inup reads its config from an env-paths dir derived from $HOME. We point ONLY
# the CLI at a throwaway HOME (via the wrapper) so the VHS shell, pnpm and node
# all keep the real $HOME — nothing else is affected, and your personal config
# is untouched. The env-paths layout differs by OS (macOS: Library/Preferences,
# Linux/CI: .config), so resolve the exact path with env-paths itself under the
# throwaway HOME rather than hardcoding one platform's layout. Seeding is belt
# and braces: even if it landed nowhere, inup falls back to 'default' anyway.
DEMO_HOME="$TEMP_DIR/home"
DEMO_CONFIG_DIR="$(
    HOME="$DEMO_HOME" node --input-type=module \
        -e "import p from 'env-paths'; process.stdout.write(p('inup').config)"
)"
mkdir -p "$DEMO_CONFIG_DIR"
printf '{"theme":"default"}\n' > "$DEMO_CONFIG_DIR/config.json"

# Wrapper script invokes the freshly built CLI directly — no pnpm link needed.
# HOME is overridden only for this process so inup resolves the seeded config.
cat > "$WRAPPER_BIN_DIR/inup" <<EOF
#!/usr/bin/env bash
exec env HOME="$DEMO_HOME" node "$CLI_ENTRY" "\$@"
EOF
chmod +x "$WRAPPER_BIN_DIR/inup"

# Never render over the tracked GIF: VHS can return success even if its
# encoder fails. A fresh path makes stale-output reuse impossible.
RAW_GIF="$TEMP_DIR/recording.gif"
echo "Recording with vhs..."
vhs "$TAPE_FILE" -o "$RAW_GIF"

if [ ! -s "$RAW_GIF" ]; then
    echo "error: VHS did not create a fresh GIF; existing demo assets were not changed." >&2
    exit 1
fi

# Validate the tape's full-resolution output before any conversions.
EXPECTED_SIZE="$(awk '/^Set Width / {w=$3} /^Set Height / {h=$3} END {print w "x" h}' "$TAPE_FILE")"
ACTUAL_SIZE="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$RAW_GIF")"
if [ "$ACTUAL_SIZE" != "$EXPECTED_SIZE" ]; then
    echo "error: Expected a fresh ${EXPECTED_SIZE} recording, got ${ACTUAL_SIZE}." >&2
    exit 1
fi

GIF="$REPO_ROOT/docs/demo/interactive-upgrade.gif"
# The README embeds the GIF, so keep that asset small: downscale the 2x render
# back to 1240 wide. A dedicated palette (palettegen/paletteuse) keeps the text
# crisp at the smaller size instead of the muddy default 256-color quantization.
# ffmpeg cannot edit a file in place, so write to a temp GIF and move it over.
echo "Downscaling GIF to 1240px with an optimized palette..."
PALETTE="$TEMP_DIR/palette.png"
GIF_SMALL="$TEMP_DIR/interactive-upgrade-1240.gif"
# -frames:v 1 + -update 1: the palette is a single image, not a numbered sequence.
ffmpeg -xerror -y -i "$RAW_GIF" -frames:v 1 -update 1 \
    -vf "scale=1240:-1:flags=lanczos,palettegen=stats_mode=diff" "$PALETTE"
ffmpeg -xerror -y -i "$RAW_GIF" -i "$PALETTE" \
    -lavfi "scale=1240:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" \
    "$GIF_SMALL"
# Only publish after the conversion has succeeded and produced output.
test -s "$GIF_SMALL"
mv "$GIF_SMALL" "$GIF"

echo "Demo recorded: docs/demo/interactive-upgrade.gif (1240px)"
