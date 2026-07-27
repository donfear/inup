---
title: CLI reference
description: Every inup flag — directories, package filters, headless JSON reports, CI checks, upgrade targets and exit codes.
order: 20
updated: 2026-07-27
---

inup is a single command. Without flags it opens the interactive picker; with `--json`, `--check` or `--apply` (or when stdout isn't a TTY) it runs headless.

```bash
inup [options]
```

## Options

| Flag | Description |
| --- | --- |
| `-d, --dir <path>` | Run in a specific directory (default: current directory) |
| `-e, --exclude <patterns>` | Exclude paths matching regex patterns, comma-separated |
| `-i, --ignore <packages>` | Ignore packages — comma-separated, glob supported (`@babel/*`) |
| `--max-depth <number>` | Maximum directory depth for `package.json` discovery (default: 10) |
| `--init` | Create a commented `.inuprc` template documenting every option (asks before overwriting) |
| `--package-manager <name>` | Force the package manager: `npm`, `yarn`, `pnpm` or `bun` |
| `--concurrency <n>` | Pin registry-fetch parallelism (1–24) and disable adaptive ramping — for slow or metered connections |
| `--json` | Print a machine-readable JSON report and exit (read-only) |
| `-c, --check` | Exit non-zero if updates exist, without writing (for CI; read-only) |
| `--apply` | Non-interactively write upgrades and install (for CI/automation) |
| `--target <level>` | With `--apply`: `minor` (default, in-range), `patch`, or `latest` |
| `--save-exact` | Write exact versions instead of preserving the range prefix (`^`/`~`) |
| `--no-color` | Disable colored output (also respects `NO_COLOR` / `FORCE_COLOR`) |
| `--debug` | Write a verbose debug log to `/tmp/inup-debug-YYYY-MM-DD.log` |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Everything up to date |
| `1` | Updates exist (with `--check`) |
| `2` | Error |

## Headless by default in pipelines

When stdout isn't a TTY or `$CI` is set, inup never opens the interactive UI — it prints a report instead, so it can't hang a pipeline. `inup | cat` gives a plain line-based report; `--json` gives the structured document.

See [CI & scripting](../ci/) for the JSON schema and `--apply` semantics, and [Configuration](../configuration/) for the `.inuprc` file that all modes honor.
