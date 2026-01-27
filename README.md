# inup

[![npm version](https://img.shields.io/npm/v/inup?logo=npm&logoColor=%23CB3837&style=for-the-badge&color=crimson)](https://www.npmjs.com/package/inup)
[![Downloads](https://img.shields.io/npm/dm/inup?style=for-the-badge&color=646CFF&logoColor=white)](https://www.npmjs.com/package/inup)
[![Total downloads](https://img.shields.io/npm/dt/inup?style=for-the-badge&color=informational)](https://www.npmjs.com/package/inup)

A powerful interactive CLI tool for upgrading dependencies with ease. **Auto-detects and works with npm, yarn, pnpm, and bun**. Inspired by `yarn upgrade-interactive`, this tool makes dependency management a breeze for any project. Perfect for monorepos, workspaces, and batch upgrades ❤️

![Interactive Upgrade Demo](docs/demo/interactive-upgrade.gif)

## What it does

Ever found yourself staring at a wall of outdated packages, wondering which ones to upgrade? This tool helps you:

- **Scans your entire project** - finds all package.json files in your workspace
- **Auto-detects your package manager** - works seamlessly with npm, yarn, pnpm, or bun
- **Checks for updates** - compares your current versions against the latest available
- **Lets you pick what to upgrade** - interactive interface to select exactly what you want
- **Does the heavy lifting** - updates your package.json files and runs the appropriate install command

## Why choose inup?

If you miss the convenience of `yarn upgrade-interactive` but want it to work with **any package manager**, this tool is perfect for you!

- **🚀 Fast & Efficient** - Batch upgrade multiple packages at once
- **🔒 Safe Updates** - Choose between minor updates or major version jumps
- **🏢 Monorepo Friendly** - Works seamlessly with workspaces
- **📦 Registry Aware** - Checks npm registry for latest versions
- **🎯 Selective Upgrades** - Pick exactly which packages to upgrade
- **⚡ Zero Config** - Works out of the box with sensible defaults

## Installation

### With npx (no installation needed)

```bash
npx inup
```

### Install globally with pnpm

```bash
pnpm add -g inup
```

### Alternative: npm

```bash
npm install -g inup
```

## Usage

Just run it in your project directory:

```bash
inup
```

The tool will scan your entire workspace (including monorepos), find outdated packages, and let you choose which ones to upgrade interactively.

### Interactive Features

- **Search**: Press `/` to search for a specific package by name
- **Navigate**: Use arrow keys to move between packages
- **Select Version**: Use `Left` and `Right` arrow keys to cycle through available versions (default, minor, patch, major)
- **Select All Minor**: Press `m` to select all minor updates
- **Package Info**: Press `i` to view detailed information about the selected package
- **Exit Search**: Press `Esc` to exit search mode

### Command line options

- `-d, --dir <directory>`: Run in a specific directory (default: current directory)
- `-e, --exclude <patterns>`: Skip directories matching these regex patterns (comma-separated)
- `-p, --peer`: Include peer dependencies in upgrade process (default: false)
- `-o, --optional`: Include optional dependencies in upgrade process (default: false)
- `--package-manager <name>`: Manually specify package manager (npm, yarn, pnpm, bun) - overrides auto-detection

**Note:** By default, the tool only processes `dependencies` and `devDependencies`. Both `peerDependencies` and `optionalDependencies` are excluded by default and must be explicitly included with their respective flags.

Examples:

```bash
# Basic usage - scans only dependencies and devDependencies
inup

# Include peer dependencies in the upgrade process
inup --peer

# Include optional dependencies
inup --optional

# Include both peer and optional dependencies
inup --peer --optional

# Skip example and test directories
inup --exclude "example,test"

# Skip specific paths with regex
inup -e "example/.*,.*\.test\..*"

# Run in a different directory
inup --dir ../my-other-project

# Combine multiple options
inup --dir ./packages --peer --exclude "test,dist"

# Force a specific package manager
inup --package-manager npm
```

### How it works

1. **Detects your package manager** - Auto-detects from lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) or package.json
2. **Scans your project** - Finds all package.json files recursively (respects exclude patterns)
3. **Collects dependencies** - Gathers dependencies based on your options (dependencies, devDependencies, and optionally peerDependencies/optionalDependencies)
4. **Checks for updates** - Queries npm registry for latest versions
5. **Shows you options** - Interactive UI lets you pick what to upgrade (minor updates or latest versions)
6. **Updates safely** - Modifies package.json files and runs the appropriate install command (`npm install`, `yarn install`, `pnpm install`, or `bun install`)

### Package Manager Detection

inup automatically detects which package manager you're using by:

1. **Checking package.json** - Looks for the `packageManager` field
2. **Checking lock files** - Scans for:
   - `pnpm-lock.yaml` → pnpm
   - `bun.lockb` → bun
   - `yarn.lock` → yarn
   - `package-lock.json` → npm
3. **Fallback to npm** - If nothing is detected, defaults to npm with a warning

You can override auto-detection using the `--package-manager` flag.

### FAQ

**Q: How does inup detect my package manager?**
A: It checks your `package.json` `packageManager` field first, then looks for lock files. You can manually override with `--package-manager`.

**Q: What if I have multiple lock files?**
A: inup will use the most recently modified lock file and show a warning. Consider cleaning up unused lock files.

**Q: Can I force a specific package manager?**
A: Yes! Use `--package-manager npm` (or yarn, pnpm, bun) to override auto-detection.

**Q: What if the detected package manager isn't installed?**
A: inup will still update your package.json files but skip the install step. It will show you the manual install command to run.

## License

MIT
