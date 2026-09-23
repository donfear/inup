# CI & scripting

Run inup non-interactively to gate builds on outdated or vulnerable dependencies, generate a machine-readable dependency report, or auto-apply safe upgrades.

inup runs headless automatically when stdin or stdout isn't a TTY or `$CI` is set, so it never hangs in a pipeline waiting on the interactive UI. Both `--json` and `--check` are **read-only** — they report, they never edit `package.json` or install.

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
- `--target patch` stays within the current `major.minor` line, and within the declared range
- `--target latest` includes majors

The in-range target (the `range` field of the JSON report, the TUI's range column) follows each specifier's operator:

| Declared | In-range target |
| --- | --- |
| `^1.2.3` | newest `1.x.x` |
| `^0.2.3` | newest `0.2.x` — under `0.x` a new minor is breaking |
| `^0.0.3` | none — nothing newer is in range |
| `~1.2.3` | newest `1.2.x` |
| `1.2.3`, `=1.2.3`, `>=1.2.3` | newest `1.x.x` |

Anything newer than that target is still reported as the latest update (`hasMajorUpdate` in the JSON report) and left for you to review — or applied with `--target latest`.

`--apply` never rewrites `peerDependencies`, at any target. A peer range says which versions of the host your package supports, and raising its floor would quietly drop support for everything below it. Outdated peer ranges still show up in the report so you can widen them yourself.

It honors [`.inuprc`](configuration.md) exactly as the report does — a package the config excludes is never written. With `--apply --json`, the install output goes to stderr so stdout stays pure JSON.

The install runs once in each project that changed: in its workspace root, or in the project's own directory when it isn't part of a workspace. If an install fails or the package manager isn't installed, `--apply` exits `2` and names each directory with the command to run there. The version bumps stay written.

## pnpm catalogs work in every mode

Dependencies declared as `catalog:` / `catalog:<name>` are resolved from `pnpm-workspace.yaml`; `--apply` writes the new range back into that file (comments and formatting preserved), and in `--json` output such entries carry a `"catalog"` field with their `packageJsonPath` pointing at `pnpm-workspace.yaml`.

## The JSON report

Each reported package carries its health signals:

- `deprecated` — the npm deprecation message, if any
- `enginesNode` — the package's declared `engines.node`
- `vulnerability` — known advisories on the currently-installed version, from the same bulk advisory endpoint `npm audit` uses, on the registry that serves each package

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
| `2` | Error, including an unknown flag or an invalid flag value, or a registry lookup failed (`--check`) |
| `130` / `143` | Cancelled (Ctrl+C / `SIGTERM`) |

A package inup could not look up — registry down, token expired, or not published — is never counted as up to date. It is listed in the report's [`failed`](json-schema.md#failedlookup) array, named in a warning on stderr, and makes `--check` exit `2` even when updates also exist, since the check could not be completed.

For scheduled upgrades with a rolling pull request, use the [GitHub Action](github-action.md).
