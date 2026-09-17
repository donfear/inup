---
title: Configuration
description: The .inuprc file — ignore packages with globs, exclude directories, extend the scan list, and control vulnerability display.
order: 40
updated: 2026-07-27
---

inup needs no configuration to run. When you want persistent project rules, add a JSON config file. inup looks for the first of these, searching from the working directory upward to the filesystem root:

1. `.inuprc`
2. `.inuprc.json`
3. `inup.config.json`

Every mode honors it — the interactive picker, `--json`, `--check` and `--apply`. A package the config excludes is never reported or written.

Despite the JSON format, `//` line comments and `/* ... */` block comments are allowed — inup strips them before parsing, so the file can document itself.

The quickest start is `inup --init`: it writes a commented `.inuprc` template with every field documented inline (and asks before overwriting an existing config).

## Example

```json
{
  "ignore": ["@babel/*", "eslint-*", "typescript"],
  "ignoreMajor": ["@tiptap/*"],
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

### `ignoreMajor`

Packages whose **major** updates are suppressed — minor and patch updates still show. Same pattern syntax as `ignore`. Use it for dependencies you deliberately keep on their current major (a UI kit mid-migration, a framework pinned by a peer range) without losing sight of safe in-range bumps.

- A package whose only available update is a new major is treated as up to date.
- When an in-range update exists, the package shows with the in-range target; the major is never offered — the interactive picker won't select it, and `--apply --target latest` holds the package to its in-range bump.
- `--json` reports such entries with `"hasMajorUpdate": false` and `"majorIgnored": true` (the `latest` field stays truthful).

```json
{
  "ignoreMajor": ["@tiptap/*"]
}
```

### `exclude`

Directory patterns to skip while discovering `package.json` files, as regular expressions. Equivalent to `--exclude`.

### `scanDirs`

Directory names to scan even though they are on the default skip list (`node_modules`, `dist`, `build`, `coverage`, `out`, `lib`, `es`, `esm`, `cjs`). Use this when a real package lives under e.g. `lib/`.

### `showPeerDependencyVulnerabilities`

Show vulnerability badges for `peerDependencies` in the package list. Defaults to `false` so peer-dependency risk stays hidden unless you opt in.

### `showOptionalDependencyVulnerabilities`

Show vulnerability badges for `optionalDependencies`. Defaults to `false`.

### `concurrency`

Pin registry-fetch parallelism for this project (integer 1–24) and disable adaptive ramping — an escape hatch for known-slow or metered connections. The `--concurrency` flag overrides it.

### `native`

Experimental. Set to `true` to fetch and parse registry data with inup's native core, written in Rust. On large projects it uses about half the CPU and a quarter less memory, and the package list stays responsive while it loads. Defaults to `false`; `--native` and `--no-native` override it for a single run.

inup itself ships without native code. The first run with native enabled downloads the core for your platform (about 1.5 MB) from your npm registry, checks it against the checksum the registry publishes, and caches it; that run still uses the standard core, and later runs use the native one. A new inup version downloads its matching core once.

Available for macOS, Linux (glibc and musl) and Windows, on x64 and arm64. Wherever the native core can't be downloaded or loaded, inup quietly uses the standard core — `--debug` logs which one is active.

## Environment variables

- `CI` — when set, inup runs headless (report mode) instead of opening the UI
- `NO_COLOR` / `FORCE_COLOR` — standard color controls, same as `--no-color`
