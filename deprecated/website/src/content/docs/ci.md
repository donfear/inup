---
title: CI & scripting
description: Run inup headless — gate builds with --check, generate versioned JSON dependency reports, and auto-apply safe upgrades in CI/CD.
order: 50
updated: 2026-07-06
---

Run inup non-interactively to gate builds on outdated or vulnerable dependencies, generate a machine-readable dependency report, or auto-apply safe upgrades.

inup runs headless automatically when stdout isn't a TTY or `$CI` is set, so it never hangs in a pipeline waiting on the interactive UI. Both `--json` and `--check` are **read-only** — they report, they never edit `package.json` or install.

```bash
inup --check                 # exit 1 if anything is outdated → fails the build
inup --json | jq             # structured drift report for dashboards/bots
inup | cat                   # plain line-based report when piped to a log
inup --apply                 # write safe in-range bumps + install (non-interactive)
inup --apply --target latest # include major bumps; --json to also emit the report
```

## `--apply`

Unlike `--json` and `--check`, **`--apply` writes**: it bumps `package.json` and runs your package manager's install to update the lockfile.

- `--target minor` (default) applies only **in-range** updates and leaves majors for you to review
- `--target patch` stays within the current `major.minor` line
- `--target latest` includes majors

It honors [`.inuprc`](../configuration/) exactly as the report does — a package the config excludes is never written. With `--apply --json`, the install output goes to stderr so stdout stays pure JSON.

## pnpm catalogs work in every mode

Dependencies declared as `catalog:` / `catalog:<name>` are resolved from `pnpm-workspace.yaml`; `--apply` writes the new range back into that file (comments and formatting preserved), and in `--json` output such entries carry a `"catalog"` field with their `packageJsonPath` pointing at `pnpm-workspace.yaml`.

## The JSON report

Each reported package carries its health signals:

- `deprecated` — the npm deprecation message, if any
- `enginesNode` — the package's declared `engines.node`
- `vulnerability` — known advisories on the currently-installed version, from one bulk `npm audit`-style request

Every advisory is **cross-referenced against the upgrade targets**, so you know whether the upgrade actually fixes it:

- `vulnerability.advisories[].fixedByRange` / `fixedByLatest` — does the in-range / latest target escape this advisory's affected range?
- `vulnerability.fixedByRange` / `fixedByLatest` — does the target clear **every** advisory?

The summary includes a `vulnerable` count, and the payload carries a `schemaVersion` so scripts and agents can pin to a known shape.

## Output hygiene

With `--json`, stdout carries **only** the JSON document; all progress and warnings go to stderr.

| Exit code | Meaning |
| --- | --- |
| `0` | Up to date |
| `1` | Updates exist (`--check`) |
| `2` | Error |

For scheduled upgrades with a rolling pull request, use the [GitHub Action](../github-action/).
