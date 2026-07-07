---
title: Configuration
description: The .inuprc file — ignore packages with globs, exclude directories, extend the scan list, and control vulnerability display.
order: 40
updated: 2026-07-06
---

inup needs no configuration to run. When you want persistent project rules, add a JSON config file. inup looks for the first of these, searching from the working directory upward to the filesystem root:

1. `.inuprc`
2. `.inuprc.json`
3. `inup.config.json`

Every mode honors it — the interactive picker, `--json`, `--check` and `--apply`. A package the config excludes is never reported or written.

## Example

```json
{
  "ignore": ["@babel/*", "eslint-*", "typescript"],
  "exclude": ["fixtures", "examples/.*"],
  "scanDirs": ["lib"],
  "showPeerDependencyVulnerabilities": false,
  "showOptionalDependencyVulnerabilities": false
}
```

## Fields

### `ignore`

Packages to skip during upgrade checks. Supports exact names and glob patterns:

- `"lodash"` — exact match
- `"@babel/*"` — every package in a scope
- `"eslint-*"` — wildcard, `*` matches any sequence, `?` matches one character

The same syntax works ad hoc via `--ignore` on the command line.

### `exclude`

Directory patterns to skip while discovering `package.json` files, as regular expressions. Equivalent to `--exclude`.

### `scanDirs`

Directory names to scan even though they are on the default skip list (`node_modules`, `dist`, `build`, `coverage`, `out`, `lib`, `es`, `esm`, `cjs`). Use this when a real package lives under e.g. `lib/`.

### `showPeerDependencyVulnerabilities`

Show vulnerability badges for `peerDependencies` in the package list. Defaults to `false` so peer-dependency risk stays hidden unless you opt in.

### `showOptionalDependencyVulnerabilities`

Show vulnerability badges for `optionalDependencies`. Defaults to `false`.

## Environment variables

- `CI` — when set, inup runs headless (report mode) instead of opening the UI
- `NO_COLOR` / `FORCE_COLOR` — standard color controls, same as `--no-color`
