#!/bin/bash

# Script to record demo with automatic package.json backup/restore
# Uses a temporary directory with a clean path to avoid exposing file system

set -e

SOURCE_PACKAGE="docs/demo-project/package.json"
TEMP_DIR="/tmp/my-app"
TAPE_FILE="docs/demo/demo-real.tape"

echo "🎬 Recording demo with clean paths..."
echo ""

# Build and link the CLI
echo "🔨 Building and linking CLI..."
pnpm build
pnpm link --global
echo "✅ CLI linked globally"
echo ""

# Create clean temp directory
echo "📁 Setting up temporary demo directory..."
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"
cp "$SOURCE_PACKAGE" "$TEMP_DIR/package.json"
echo "✅ Demo directory created at $TEMP_DIR"
echo ""

# Function to cleanup
cleanup() {
    echo ""
    echo "🧹 Cleaning up..."
    
    echo "🔗 Unlinking global package..."
    pnpm unlink --global inup 2>/dev/null || true
    
    echo "🗑️  Removing temporary directory..."
    rm -rf "$TEMP_DIR"
    
    echo "✅ Cleanup complete"
}

# Ensure cleanup happens even if recording fails
trap cleanup EXIT

# Record the demo
echo "🎥 Recording demo..."
vhs "$TAPE_FILE"
echo ""
echo "✅ Demo recorded successfully!"
echo "   Output: docs/demo/interactive-upgrade.gif"
echo ""
