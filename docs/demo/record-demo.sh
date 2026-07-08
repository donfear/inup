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

# Record with the shipped Default theme, never the maintainer's saved theme.
# inup reads its config from an env-paths dir derived from $HOME. We point ONLY
# the CLI at a throwaway HOME (via the wrapper) so the VHS shell, pnpm and node
# all keep the real $HOME — nothing else is affected, and your personal config
# is untouched. The env-paths layout differs by OS (macOS: Library/Preferences,
# Linux/CI: .config), so resolve the exact path with env-paths itself under the
# throwaway HOME rather than hardcoding one platform's layout. Seeding is belt
# and braces: even if it landed nowhere, inup falls back to 'default' anyway.
DEMO_HOME="$TEMP_DIR/.home"
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

# Prepend wrapper dir so VHS's shell sees inup on PATH.
export PATH="$WRAPPER_BIN_DIR:$PATH"

cleanup() {
    echo "Cleaning up..."
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "Recording with vhs..."
vhs "$TAPE_FILE"

GIF="$REPO_ROOT/docs/demo/interactive-upgrade.gif"
MP4="$REPO_ROOT/docs/demo/interactive-upgrade.mp4"

# The mp4 (website hero) is encoded from the full 2x GIF, before the GIF is
# downscaled — so the hero keeps every rendered pixel. lanczos scaling + crf 20
# is visibly sharper than the old crf 28; still tiny next to the GIF.
echo "Converting to mp4 for the website (full 2x)..."
ffmpeg -y -i "$GIF" \
    -movflags faststart -pix_fmt yuv420p \
    -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos" -crf 20 -an \
    "$MP4"

# The README embeds the GIF, so keep that asset small: downscale the 2x render
# back to 1240 wide. A dedicated palette (palettegen/paletteuse) keeps the text
# crisp at the smaller size instead of the muddy default 256-color quantization.
echo "Downscaling GIF to 1240px with an optimized palette..."
PALETTE="$TEMP_DIR/palette.png"
ffmpeg -y -i "$GIF" -vf "scale=1240:-1:flags=lanczos,palettegen=stats_mode=diff" "$PALETTE"
ffmpeg -y -i "$GIF" -i "$PALETTE" \
    -lavfi "scale=1240:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" \
    "$GIF"

echo "Demo recorded: docs/demo/interactive-upgrade.gif (1240px) + .mp4 (2x)"
