# inup — Interactive Dependency Upgrader

[![npm version](https://img.shields.io/npm/v/inup?logo=npm&logoColor=%23CB3837&style=for-the-badge&color=crimson)](https://www.npmjs.com/package/inup)
[![Downloads](https://img.shields.io/npm/dm/inup?style=for-the-badge&color=646CFF&logoColor=white)](https://www.npmjs.com/package/inup)
[![Total downloads](https://img.shields.io/npm/dt/inup?style=for-the-badge&color=informational)](https://www.npmjs.com/package/inup)
[![CI](https://img.shields.io/github/actions/workflow/status/donfear/inup/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/donfear/inup/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://github.com/donfear/inup/blob/main/LICENSE)

Interactively upgrade outdated dependencies across npm, yarn, pnpm, and bun. Auto-detects your package manager, works in monorepos and workspaces, and requires zero configuration.

![Interactive Upgrade Demo](docs/demo/interactive-upgrade.gif)

## Quick Start

```bash
npx inup
```

Or install globally with your preferred package manager:

```bash
npm install -g inup
pnpm add -g inup
yarn global add inup
bun add -g inup
```

Run `inup` in any project — it scans for outdated packages and lets you pick what to upgrade.

## Why inup?

- **All Dependencies at Once** — Dev, peer, and optional dependencies load automatically. No more re-running with `--peer` or `--dev` flags.
- **Live Toggles** — Filter dependency types (`d`, `p`, `o`) on the fly without restarting.
- **Zero Config** — Auto-detects npm, yarn, pnpm, or bun from your lockfile.
- **Monorepo Ready** — Discovers and upgrades across workspaces seamlessly.
- **Vulnerability Audit** — Flags known security vulnerabilities right in the package list so you know what's risky before upgrading.
- **Changelog Viewer** — Read release notes and changelogs inline without leaving the terminal.
- **Built-in Search** — Press `/` to filter packages instantly.
- **Package Details** — Press `i` to view package info, download stats, and more.
- **Themes** — Press `t` to switch between color themes.

## Options

```bash
inup [options]

-d, --dir <path>              Run in specific directory
-e, --exclude <patterns>      Skip directories (comma-separated regex)
-i, --ignore <packages>       Ignore packages (comma-separated, glob supported)
--max-depth <number>          Maximum scan depth for package discovery (default: 10)
--package-manager <name>      Force package manager (npm, yarn, pnpm, bun)
--json                        Print a machine-readable JSON report and exit (read-only)
-c, --check                   Exit non-zero if updates exist, without writing (for CI)
--debug                       Write verbose debug logs
```

## CI & Scripting

`inup` runs headless automatically when stdout isn't a TTY or `$CI` is set, so it never hangs in a
pipeline waiting on the interactive UI. Both `--json` and `--check` are **read-only** — they report,
they never edit `package.json` or install.

```bash
inup --check            # exit 1 if anything is outdated → fails the build
inup --json | jq        # structured drift report for dashboards/bots
inup | cat              # plain line-based report when piped to a log
```

Each reported package carries its health signals: `deprecated` (npm deprecation message), `enginesNode`
(declared `engines.node`), and `vulnerability` (known advisories on the currently-installed version,
from one bulk `npm audit`-style request). Every advisory is **cross-referenced against the upgrade
targets**, so you know whether the upgrade actually fixes it:

- `vulnerability.advisories[].fixedByRange` / `fixedByLatest` — does the in-range / latest target escape
  this advisory's affected range?
- `vulnerability.fixedByRange` / `fixedByLatest` — does the target clear **every** advisory?

The summary includes a `vulnerable` count, and the payload carries a `schemaVersion` so scripts and
agents can pin to a known shape.

Output hygiene: with `--json`, stdout carries **only** the JSON document; all progress and warnings go
to stderr. Exit codes: `0` up to date, `1` updates exist (`--check`), `2` error.

## Keyboard Shortcuts

<!-- KEYS:START -->
| Key | Action |
|-----|--------|
| `↑ / k` | Move up |
| `↓ / j` | Move down |
| `g` | Jump to the first package |
| `G` | Jump to the last package |
| `←` | Cycle selection left (none → range → latest) |
| `→` | Cycle selection right (none → range → latest) |
| `Space` | Toggle the current package on/off |
| `m` | Select all minor/patch updates |
| `l` | Select all latest updates (including major) |
| `u` | Unselect all packages |
| `Enter` | Confirm selection and upgrade |
| `/` | Search packages by name |
| `d` | Toggle devDependencies |
| `p` | Toggle peerDependencies |
| `o` | Toggle optionalDependencies |
| `s` | Run the vulnerability audit |
| `v` | Show only vulnerable packages |
| `Esc` | Clear the active search filter |
| `i` | View package details and changelog |
| `t` | Change the color theme |
| `?` | Show this help |
| `!` | Show the performance/debug panel |
<!-- KEYS:END -->

## Privacy

No tracking, no telemetry, no data collection. Package metadata is fetched directly from the npm registry. Download counts come from the npm downloads API. When needed for exact-version manifests, inup may fetch a pinned `package.json` from jsDelivr.

## License

[MIT](LICENSE)
