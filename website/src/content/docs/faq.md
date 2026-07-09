---
title: FAQ & troubleshooting
description: Common questions about inup — does it edit lockfiles, why a package is skipped, private registries, headless/CI detection, colors, and telemetry.
order: 80
updated: 2026-07-09
---

## Does inup edit my files or run install?

It depends on the mode:

- **Interactive** (the default): nothing is written until you confirm. When you press `Enter` on your selection, inup bumps `package.json` (and `pnpm-workspace.yaml` for catalog entries) and runs your package manager's install to update the lockfile.
- **`--json` and `--check`**: **read-only** — they report and exit, never touching `package.json` or the lockfile.
- **`--apply`**: the only non-interactive write path — it applies the bumps and runs install. See [CI & scripting](../ci/).

By default the range prefix is preserved (`^`/`~`); pass [`--save-exact`](../cli/) to write exact versions instead.

## Why is a package (or directory) being skipped?

A few things cause inup to skip something:

- **Ignored packages** — anything matching `ignore` in [`.inuprc`](../configuration/) or `-i, --ignore` (glob supported, e.g. `@babel/*`).
- **Excluded directories** — anything matching `exclude` in `.inuprc` or `-e, --exclude` (regex).
- **Default skip list** — inup does not descend into `node_modules`, `dist`, `build`, `coverage`, `out`, `lib`, `es`, `esm`, or `cjs`. If a real package lives under one of those (e.g. `lib/`), add it to `scanDirs` in `.inuprc`.
- **Scan depth** — package discovery stops at `--max-depth` (default `10`) directories deep.

## How does inup know which package manager to use?

It auto-detects from your lockfile (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`/`bun.lock`). Force it with `--package-manager npm|yarn|pnpm|bun` when a repo has more than one lockfile.

## Do private registries and `.npmrc` work?

Yes. inup resolves registries and credentials with npm's own model, reading your project, user, and global `.npmrc`: scoped registries (`@scope:registry=…`) and credentials (`_authToken`, `username`/`_password`, legacy `_auth`), with `${ENV_VAR}` values expanded. A token is only ever sent to the registry its config binds it to. No extra setup — if npm can install it, inup can read it.

## It printed JSON / a plain list instead of opening the UI

That's the headless fallback, and it's intentional. inup runs headless — never opening the interactive UI — when **any** of these is true:

- stdout isn't a TTY (e.g. piped: `inup | cat`),
- the `CI` environment variable is set,
- you passed `--json`, `--check`, or `--apply`.

This keeps it from hanging a pipeline. To force the interactive picker, run it in a real terminal without those flags.

## How do I turn off colors?

Pass `--no-color`, or set the standard `NO_COLOR` environment variable. `FORCE_COLOR` is also respected. Useful for log files and CI output.

## It warned about a dirty working tree

In interactive mode, inup warns before changing anything if your git working tree has uncommitted changes, so an upgrade diff stays easy to review and revert. Commit or stash first, or continue past the prompt. Headless mode skips the prompt (it's read-only unless `--apply`).

## Does inup send any telemetry?

No. There is no tracking, no telemetry, and no data collection. Package metadata comes straight from the npm registry, download counts from the npm downloads API, and changelogs/release notes from GitHub — nothing else leaves your machine.

## What Node version do I need?

Node `22.19` or newer (`engines.node`). `npx inup` uses your local Node; the [GitHub Action](../github-action/) defaults to Node 22.

## Still stuck?

Run with `--debug` to write a verbose log (`/tmp/inup-debug-YYYY-MM-DD.log`), then [open an issue](https://github.com/donfear/inup/issues) with it attached.
