# Demo Recording Guide

This directory contains tools and scripts for creating automated, high-quality demo recordings of the CLI.

## Problem with the Current Approach

The original `interactive-upgrade.tape` file manually types fake output, which:
- Doesn't show real functionality
- Requires manual maintenance when the UI changes
- Doesn't demonstrate the async loading behavior

## Better Solutions

### Option 1: VHS with Real CLI Execution (Current Setup)

**Pros:**
- Runs the actual CLI
- Shows real async behavior
- High quality GIF output
- Automated once set up

**Cons:**
- Timing-dependent (needs Sleep adjustments)
- Output changes as package versions update
- Requires internet connection for npm registry queries

**Setup:**

1. Install VHS if you haven't:
   ```bash
   brew install vhs
   ```

2. Build the project and record:
   ```bash
   pnpm demo:record
   ```

3. The GIF will be generated at `docs/demo/interactive-upgrade.gif`

**How it works:**

The recording script (`record-demo.sh`) automatically:
- Creates a temporary directory at `/tmp/my-app` with the demo `package.json`
- Links your latest built CLI globally
- Runs the actual CLI and performs real upgrades
- Cleans up temp directory and unlinks the package after recording
- This ensures clean paths in the demo (no file system exposure) and genuine functionality

**Adjusting the Recording:**

Edit `demo-real.tape` to:
- Change `Sleep` durations if your CLI loads faster/slower (currently 5s for initial load)
- Modify keyboard interactions (Up/Down/Left/Right/M/L/U/Enter)
- Adjust window size or playback speed
- The demo shows selecting all minor updates, then customizing individual packages (major, minor, keep current)
- Two Enter presses complete the upgrade (confirm selections, then install)

### Option 2: Asciinema + agg (Recommended for Interactive CLIs)

**Pros:**
- Records real terminal sessions
- Easy to re-record if something goes wrong
- Can edit recordings before converting to GIF
- Better handling of async/interactive apps

**Cons:**
- Two-step process (record, then convert)
- Requires two tools

**Setup:**

1. Install tools:
   ```bash
   brew install asciinema agg
   ```

2. Record a session:
   ```bash
   cd docs/demo-project
   asciinema rec recording.cast
   # Now use your CLI naturally
   ../../dist/cli.js
   # Navigate around, make selections
   # Press Ctrl+D when done
   ```

3. Convert to GIF:
   ```bash
   agg recording.cast interactive-upgrade.gif
   ```

**Advanced options:**
```bash
# Record with specific dimensions
asciinema rec -c "../../dist/cli.js" --cols 140 --rows 40 recording.cast

# Convert with custom settings
agg --speed 1.5 --theme monokai recording.cast interactive-upgrade.gif
```

### Option 3: Add a Demo Mode to the CLI (Best Long-term Solution)

To make recordings reproducible and reliable, consider adding a `--demo` or `--offline` flag that:
- Uses pre-cached package version data
- Ensures consistent output every time
- Removes timing dependencies

This would involve:
1. Creating a fixture file with mock package data
2. Adding a CLI flag to use mock data instead of npm registry
3. Recording with the demo mode enabled

Example implementation idea:
```typescript
// In your CLI
if (options.demo) {
  // Load mock data from fixtures instead of npm registry
  const mockData = require('./fixtures/demo-data.json');
  // Use mockData for the interactive UI
}
```

## Current Demo Project

The `demo-project` directory contains a package.json with intentionally outdated dependencies:
- chalk ^4.0.0 (latest: ^5.x)
- commander ^8.0.0 (latest: ^14.x)
- express ^4.17.1 (latest: ^5.x)
- And more...

This ensures there are always packages to upgrade in the demo.

## Tips for Great Recordings

1. **Clean terminal**: Run `clear` before starting
2. **Consistent timing**: Use `Sleep` commands generously
3. **Show key features**: Navigate through the UI, use shortcuts (M/L/U)
4. **Keep it short**: 30-60 seconds is ideal
5. **Test first**: Do a practice run to check timing
6. **Stay dependency-focused**: Show search, selection, package info, and the final upgrade path

## Troubleshooting

**VHS tape times out or shows partial UI:**
- Increase the `Sleep` duration after running the CLI (currently 3s in `demo-real.tape`)
- Your internet might be slow, affecting npm registry queries
- The demo actually runs upgrades, so make sure the demo project has internet access

**Asciinema recording looks wrong:**
- Make sure your terminal size is consistent
- Use `--cols` and `--rows` flags to set specific dimensions

**GIF file is too large:**
- Reduce recording duration
- Lower the frame rate in VHS with `Set FrameRate 30`
- Use `gifsicle` to optimize: `gifsicle -O3 input.gif -o output.gif`
