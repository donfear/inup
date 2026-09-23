# CLI reference

inup is a single command. Without flags it opens the interactive picker; with `--json`, `--check` or `--apply` (or when stdin or stdout isn't a TTY) it runs headless.

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
| `--native` | Use the [native core](configuration.md#native) (on by default), downloading it on first use even with `--json`, `--check` or `--apply` |
| `--no-native` | Use the standard core for this run, even if `.inuprc` enables native |
| `--json` | Print a machine-readable JSON report and exit (read-only) |
| `-c, --check` | Exit non-zero if updates exist, without writing (for CI; read-only) |
| `--apply` | Non-interactively write upgrades and install (for CI/automation). Never rewrites `peerDependencies` |
| `--target <level>` | With `--apply`: `minor` (default, in-range), `patch`, or `latest` |
| `--minimum-release-age <minutes>` | Supply-chain cooldown: only offer versions published at least this many minutes ago (also via `.inuprc`) |
| `--save-exact` | Write exact versions instead of preserving the range prefix (`^`/`~`) |
| `--no-color` | Disable colored output (also respects `NO_COLOR` / `FORCE_COLOR`) |
| `--debug` | Write a verbose debug log to `inup/inup-debug-YYYY-MM-DD.log` in your system temp directory (the exact path is printed when the run starts) |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success (with `--check`: everything up to date). Quitting the picker with `q` exits 0 too |
| `1` | Updates exist (with `--check`) |
| `2` | Error, including an unknown flag or an invalid flag value, or (with `--check`) a package could not be looked up on the registry — this wins over `1` |
| `130` | Cancelled with Ctrl+C |
| `143` | Stopped with `SIGTERM` |

## Headless by default in pipelines

When stdin or stdout isn't a TTY or `$CI` is set (to anything but `false` or `0`), inup never opens the interactive UI — it prints a report instead, so it can't hang a pipeline. `inup | cat` gives a plain line-based report; `--json` gives the structured document.

See [CI & scripting](ci.md) for the JSON schema and `--apply` semantics, and [Configuration](configuration.md) for the `.inuprc` file that all modes honor.
