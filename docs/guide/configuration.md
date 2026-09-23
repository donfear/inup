# Configuration

inup needs no configuration to run. When you want persistent project rules, add a JSON config file. inup looks for the first of these, searching from the working directory upward to the filesystem root:

1. `.inuprc`
2. `.inuprc.json`
3. `inup.config.json`

The first file found wins and inup stops looking: configs are never merged, and no other file stands in for a broken one. If that file can't be parsed, inup exits with an error (code 2) naming the file and where parsing failed, instead of running without your settings. A field inup doesn't recognize, usually a typo, is ignored with a warning that names it.

Every mode honors it — the interactive picker, `--json`, `--check` and `--apply`. A package the config excludes is never reported or written.

Despite the JSON format, `//` line comments, `/* ... */` block comments and trailing commas are allowed — inup strips them before parsing, so the file can document itself.

The quickest start is `inup --init`: it writes a commented `.inuprc` template with every field documented inline (and asks before overwriting an existing config).

## Example

```json
{
  "ignore": ["@babel/*", "eslint-*", "typescript"],
  "ignoreMajor": ["@tiptap/*"],
  "exclude": ["fixtures", "examples/.*"],
  "scanDirs": ["lib"],
  "minimumReleaseAge": 10080,
  "minimumReleaseAgeExclude": ["@myco/*"],
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

Directory names to scan even though they are on the default skip list (`node_modules`, `dist`, `build`, `coverage`, `out`, `lib`, `es`, `esm`, `cjs`, plus anything starting with `.` or `__`). Use this when a real package lives under e.g. `lib/`.

### `showPeerDependencyVulnerabilities`

Show vulnerability badges for `peerDependencies` in the package list. Defaults to `false` so peer-dependency risk stays hidden unless you opt in.

### `showOptionalDependencyVulnerabilities`

Show vulnerability badges for `optionalDependencies`. Defaults to `false`.

### `concurrency`

Pin registry-fetch parallelism for this project (integer 1–24) and disable adaptive ramping — an escape hatch for known-slow or metered connections. The `--concurrency` flag overrides it.

### `native`

Fetch and parse registry data with inup's native core, written in Rust. On large projects it uses about half the CPU and a quarter less memory, and the package list stays responsive while it loads. Defaults to `true`; set `false` to keep native code off a project. `--native` and `--no-native` override it for a single run.

inup itself ships without native code. The first interactive run downloads the core for your platform (about 1.5 MB) from your npm registry, checks it against the checksum the registry publishes and against the hash built into your copy of inup, and caches it (the cached file is checked again on every run); that run still uses the standard core, and later runs use the native one. A new inup version downloads its matching core once. Scripted runs (`--json`, `--check`, `--apply`, CI) use a cached core but don't download one unless you pass `--native` or set `"native": true`, so they never wait on the download.

Available for macOS, Linux (glibc and musl) and Windows, on x64 and arm64. Wherever the native core can't be downloaded or loaded, inup quietly uses the standard core — `--debug` logs which one is active.

### `minimumReleaseAge`

Supply-chain cooldown, in **minutes** (matching pnpm's setting of the same name). Versions published more recently than this are not offered as upgrade targets — in the picker, in reports, or under `--apply`. Freshly published versions are the ones most likely to be a compromised release nobody has caught yet. `0` or absent disables it; `10080` is 7 days. The `--minimum-release-age` flag overrides it.

Unlike other tools' cooldowns, inup does not skip silently: a withheld version shows a `[HELD]` badge in the picker, appears in the `heldByCooldown` array of the `--json` report, and gets its own table in the GitHub Action's PR body.

A `[HELD]` badge on a row means that package has an upgrade you can take *and* something newer that was withheld; press `i` to see which version and how old it is. A package whose *every* newer version is inside the window is no longer outdated, so it has no row at all; the picker header counts those separately as "fully held", and `c` brings them into the list. They can't be selected, because there is nothing to upgrade to yet.

Registries that don't expose publish times are unaffected — the policy acts only on positive evidence. Enabling the cooldown fetches the full registry metadata rather than the abbreviated format, since only the full document carries publish times. Measured against the largest packages on the public registry (`aws-sdk`, `@types/node`), that is about 20% more bytes over the wire and roughly 3x the memory while a package is being parsed — around 10 MB rather than 3.5 MB, briefly, per in-flight package. Later runs are cushioned by the ETag cache.

### `minimumReleaseAgeExclude`

Packages exempt from `minimumReleaseAge` — typically your own first-party packages, which you want immediately. Same pattern syntax as `ignore`.

## Environment variables

- `CI` — when set, inup runs headless (report mode) instead of opening the UI
- `NO_COLOR` / `FORCE_COLOR` — standard color controls, same as `--no-color`
