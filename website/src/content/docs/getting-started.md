---
title: Getting started
description: Install and run inup — the interactive dependency upgrader for npm, yarn, pnpm and bun. Zero config, monorepo-ready.
order: 10
updated: 2026-07-06
---

inup is an interactive CLI for upgrading outdated npm dependencies. It auto-detects your package manager, works in monorepos and workspaces, and requires zero configuration.

## Quick start

Run it in any project — nothing to install first:

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

## What happens when you run it

1. inup scans the directory for `package.json` files — including every workspace in a monorepo — and detects your package manager from the lockfile (npm, yarn, pnpm or bun).
2. It checks the npm registry for newer versions of every dependency: production, dev, peer and optional, all loaded automatically.
3. The interactive picker opens. Browse packages, run the vulnerability audit (`s`), read changelogs (`i`), search (`/`), and select the upgrades you want.
4. Press `Enter` — inup writes the new ranges to the right `package.json` (or `pnpm-workspace.yaml` for catalog entries) and runs your package manager's install.

See [keyboard shortcuts](../keyboard-shortcuts/) for everything the picker can do.

## Requirements

- Node.js `>=22.19.0`
- One of: npm, yarn, pnpm or bun (detected automatically from the lockfile)

## Monorepos

There is nothing to configure. inup discovers every workspace in one pass and shows all upgradable dependencies in a single picker. Dependencies declared as `catalog:` / `catalog:<name>` are resolved from `pnpm-workspace.yaml` and upgraded right there — comments and formatting preserved.

## Private registries

inup honors your `.npmrc` (project, user and global): scoped registries (`@scope:registry=…`) and credentials (`_authToken`, `username`/`_password`, `${ENV_VAR}` expansion) work exactly like npm's own resolution.

## Next steps

- [CLI reference](../cli/) — every flag, exit codes, headless behavior
- [Configuration](../configuration/) — `.inuprc` for ignores and scan rules
- [CI & scripting](../ci/) — gate builds, JSON reports, auto-apply
- [GitHub Action](../github-action/) — one rolling upgrade PR on a schedule
