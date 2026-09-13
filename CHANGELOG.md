# Changelog

All notable changes to [`inup`](https://www.npmjs.com/package/inup), written
for people using the CLI. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- The interactive picker opens before repository scanning, keeping discovery and loading on one branded screen. Quitting cancels pending registry requests, and scan failures restore the terminal before printing the error.
- The interactive picker now supports `q` to quit, Home/End and PgUp/PgDn navigation, and keeps its shortcut footer within narrow terminals.
- `--json` and `--check` start the vulnerability audit as soon as the dependency list is known, overlapping it with the registry fetch instead of adding its round-trip (~300 ms) after the last package resolves. The audit now covers every declared dependency's current version; the report still lists advisories for outdated packages only.
- Faster startup: the CLI loads only the code path it runs (headless runs no longer load the interactive UI) and enables Node's compile cache, taking about 60 ms off every invocation.

### Fixed

- Page navigation stops at the first and last package instead of wrapping around the list.
- Cold runs (empty ETag cache) no longer take 2–5× longer than they should. The adaptive controller judged goodput by completions per second, and since full packuments range from a few KB to several MB, a window that happened to contain big packages looked like a stalled link: parallelism collapsed to 3 and stayed there. Download-heavy windows are now measured in streamed bytes per second, and a link that proves wide is held at the full pool for the run. On a 190-package project a cold run went from 5–24 s to a steady ~5 s, matching a pinned `--concurrency 24`; warm runs are unchanged.
- The performance panel shows goodput in MB/s for download-heavy windows and marks a fast-link hold in the controller state.

## [1.7.1] - 2026-09-12

### Changed

- Results appear one at a time in their sorted position the moment they resolve, instead of arriving in batches held behind request order — a single slow scoped package no longer stalls the list or leaves it blank. Once you have started navigating, the cursor stays on the package you were looking at as rows insert above it, and an open info modal moves with it ([#116](https://github.com/donfear/inup/pull/116)).
- Only the rows that changed are repainted, with background updates coalesced into one frame, so the list no longer flickers while it loads ([#116](https://github.com/donfear/inup/pull/116)).
- The performance panel reports registry latency — average, p95 and slowest — in place of per-batch timings ([#116](https://github.com/donfear/inup/pull/116)).
- Performance records written by `INUP_PERF=1` moved to schema 2: the `firstBatch` phase is now `firstResult`, and `config.batchSize` is gone ([#116](https://github.com/donfear/inup/pull/116)).

## [1.7.0] - 2026-08-18

*Windows gets the same care as macOS and Linux.*

### Fixed

- `package.json` files written with CRLF line endings keep them. An upgrade that rewrote the file previously converted the whole thing to LF, turning a one-line version change into a full-file diff for anyone on Windows ([#108](https://github.com/donfear/inup/pull/108)).
- The upgrade log shows the project directory instead of the full `package.json` path on Windows, where the path was trimmed by a hardcoded `/package.json` replacement that never matched a backslash path ([#108](https://github.com/donfear/inup/pull/108)).
- CRLF line endings in release notes fetched from GitHub no longer jump the cursor to column zero mid-render, which scrambled the changelog modal ([#108](https://github.com/donfear/inup/pull/108)).

## [1.6.11] - 2026-07-29

*Prerelease channels finally behave.*

### Changed

- Version columns size themselves to the terminal and truncate in the middle, so long prerelease versions no longer wrap a row ([#102](https://github.com/donfear/inup/pull/102)).

### Fixed

- Dependencies pinned to a prerelease (`1.0.0-beta.2`) never saw newer prereleases: prereleases were dropped while parsing the registry response, and the tag was stripped during comparison. Prerelease installs now see newer prereleases and the eventual stable release; stable installs are still never offered a prerelease ([#102](https://github.com/donfear/inup/pull/102)).
- Upgrading a prerelease writes the full range (`^1.0.0-rc.3`) instead of silently collapsing it to `^1.0.0` ([#102](https://github.com/donfear/inup/pull/102)).

## [1.6.10] - 2026-07-27

### Added

- `ignoreMajor` in `.inuprc` — package names or globs, same syntax as `ignore`, whose major updates are never offered while their in-range minor and patch updates still surface. A package whose only update is a major one counts as up to date instead of nagging forever. Honored everywhere, including `--json` (where the entry carries `majorIgnored: true`), `--check` and `--apply --target latest` ([#100](https://github.com/donfear/inup/pull/100)).
- `--init` writes a commented `.inuprc` template into the current directory, documenting `ignore`, `ignoreMajor`, `exclude`, `scanDirs`, the peer and optional vulnerability display options, and `concurrency`. It asks before overwriting an existing config — and in CI, or with no terminal to ask in, refuses rather than clobbering it — then points out when an older config under a different name is now shadowed by `.inuprc` ([#101](https://github.com/donfear/inup/pull/101)).

### Changed

- Project config files (`.inuprc`, `.inuprc.json`, `inup.config.json`) may now contain `//` and `/* */` comments ([#101](https://github.com/donfear/inup/pull/101)).

## [1.6.9] - 2026-07-22

*inup learns how much your connection can take.*

### Added

- `--concurrency <n>` pins registry-fetch parallelism between 1 and 24 and turns off the automatic ramping, for slow or metered connections. The same value can live in `.inuprc` ([#96](https://github.com/donfear/inup/pull/96)).

### Changed

- Parallelism is learned per network rather than fixed. inup measures throughput as it fetches and settles on the level the link actually sustains, instead of holding 24 sockets open on a connection that can't feed them, and remembers that profile for a week so the next run starts warm. The loading line notes "slow connection, reduced parallelism" when it kicks in, and the performance panel reports the controller's state and last measured throughput ([#96](https://github.com/donfear/inup/pull/96)).
- Escape hatches, in order of precedence: `--concurrency`, then `.inuprc`, then the learned profile, then the cold default. `INUP_CONTROLLER=aimd` selects the previous controller and `INUP_NET_PROFILE=0` stops the profile being read or written ([#96](https://github.com/donfear/inup/pull/96)).

## [1.6.8] - 2026-07-07

### Added

- A [website](https://donfear.github.io/inup/) with documentation, release notes and package-manager comparisons ([#88](https://github.com/donfear/inup/pull/88)).

### Fixed

- `--target patch` behaved exactly like `--target minor`, so a patch-only policy could silently apply minor bumps. It now takes the highest patch within the current `major.minor` and skips packages whose only update crosses a minor boundary ([#83](https://github.com/donfear/inup/pull/83)).
- `npm:` aliases and `git:`, `git+*` and `http(s):` specifiers are skipped instead of being looked up as registry packages — previously they could be offered a nonsense upgrade that replaced the original specifier on write ([#84](https://github.com/donfear/inup/pull/84)).

## [1.6.7] - 2026-07-04

*Private registries and pnpm catalogs — the two things that made inup unusable at work.*

### Added

- Private registry support. Registries and credentials are resolved through the npm config chain — project, user and global `.npmrc` plus `npm_config_*` environment variables — via `registry-auth-token`, covering scoped registries, `_authToken`, `username`/`_password`, legacy `_auth` and `${ENV_VAR}` expansion. Download counts are not requested for packages that resolve to a non-public registry, so private names aren't sent to `api.npmjs.org` ([#74](https://github.com/donfear/inup/pull/74)).
- pnpm catalog support. `catalog:` dependencies resolve against the nearest `pnpm-workspace.yaml`, appear as a single deduplicated row marked `[C]`, and upgrades are written back into `pnpm-workspace.yaml` with its comments and key order intact. The info modal names the catalog and which workspace packages use it, and `--json` entries gained a `catalog` field ([#75](https://github.com/donfear/inup/pull/75)).

### Changed

- `GITHUB_TOKEN` or `GH_TOKEN`, when set, is used for changelog lookups, raising the GitHub API allowance from 60 to 5,000 requests per hour ([#76](https://github.com/donfear/inup/pull/76)).
- Faster startup: the self-update check queries the registry directly instead of spawning `npm view`, and the request cache moved to the per-OS cache directory so it survives reboots and temp-directory sweeps ([#76](https://github.com/donfear/inup/pull/76)).

### Fixed

- All terminal text — package names, descriptions and fetched release notes — is measured by display width, so CJK characters, emoji and combining marks no longer misalign or overflow the columns ([#77](https://github.com/donfear/inup/pull/77)).

## [1.6.4] - 2026-06-30

### Fixed

- GitHub Action: the pull request body listed the same upgrade once per workspace and dependency type. Identical upgrades now collapse into a single row, with the summary line reporting both the unique count and the total across workspaces.

## [1.6.3] - 2026-06-30

*From "a tool you run" to "a job that runs itself."*

### Added

- `--apply` writes the upgrades and runs the install with no interactive step, honoring the `ignore` and `exclude` rules from `.inuprc`. `--target <level>` decides how far it goes: `minor` (in-range, the default), `patch`, or `latest` (majors included). Paired with `--json`, install output is routed to stderr so stdout stays valid JSON for whatever is parsing it. Note that `patch` did not actually behave differently from `minor` until 1.6.8 ([#67](https://github.com/donfear/inup/pull/67)).
- A GitHub Action, `donfear/inup@v1`. Point it at a repository on a schedule and it opens one rolling pull request with the upgrades and a per-package digest of which advisories they fix — later runs update that same PR instead of piling up new ones. Inputs cover `target`, `directory`, `package-manager`, `node-version`, `inup-version`, `pr-branch`, `pr-title`, `commit-message`, `base`, `labels`, `token`, `committer` and `author`; it reports `outdated`, `vulnerable` and `pull-request-number` back to the workflow ([#67](https://github.com/donfear/inup/pull/67), [#69](https://github.com/donfear/inup/pull/69)).
- The Action validates its `target` and `package-manager` inputs up front, enables Corepack and forwards the package manager to inup so the lockfile is regenerated by the right tool, and tracks a floating `v1` tag so pinning to `@v1` picks up fixes ([#69](https://github.com/donfear/inup/pull/69)).

## [1.6.1] - 2026-06-30

### Added

- `INUP_PERF=1` writes a self-contained JSON record of a run's timings, with `INUP_PERF_DIR` to collect records from several runs in one place ([#64](https://github.com/donfear/inup/pull/64)).

### Changed

- Registry fetching adapts its concurrency to the connection, backing off when the registry returns 429 or 503 rather than holding a fixed level of parallelism. `INUP_ADAPTIVE=0` restores the fixed pool ([#64](https://github.com/donfear/inup/pull/64)).
- Repeat runs revalidate cached responses with ETags instead of refetching them in full ([#64](https://github.com/donfear/inup/pull/64)).

### Removed

- The persistent on-disk package cache, replaced by ETag revalidation — results are always current, without paying for a full refetch ([#64](https://github.com/donfear/inup/pull/64)).

## [1.6.0] - 2026-06-01

*inup becomes a program, not just a terminal UI.*

### Added

- Headless mode. `--json` prints a machine-readable report — stdout carries only JSON, progress and warnings go to stderr — and `-c, --check` exits non-zero when updates exist. Both are read-only. Headless turns itself on when stdout isn't a terminal or `$CI` is set, and a piped run with neither flag prints a plain line-based report instead of escape codes. Exit codes: `0` up to date, `1` updates available (with `--check`), `2` error ([#57](https://github.com/donfear/inup/pull/57), [#58](https://github.com/donfear/inup/pull/58)).
- The JSON report answers the question that actually matters about a vulnerability: whether upgrading fixes it. Every advisory carries `fixedByRange` and `fixedByLatest`, rolled up to the same verdict per package, next to `schemaVersion`, a `summary` with the vulnerable count, and per-package `deprecated` and `enginesNode` ([#58](https://github.com/donfear/inup/pull/58)).
- Deprecation and engine warnings, read from data inup already fetches, so they cost no extra requests. Packages carry `[DEPR]` and `[ENG]` badges in the list, with the npm deprecation message and the declared `engines.node` spelled out in the info modal ([#49](https://github.com/donfear/inup/pull/49)).
- `--save-exact` writes bare versions instead of preserving the existing `^` or `~` prefix ([#48](https://github.com/donfear/inup/pull/48)).
- `--no-color`, which also honors `NO_COLOR` and `FORCE_COLOR` ([#48](https://github.com/donfear/inup/pull/48)).
- `scanDirs` in `.inuprc` re-includes directories that are skipped by default (`node_modules`, `dist`, `build`, `lib`, …). A skipped `lib`, `es`, `esm` or `cjs` directory that contains a `package.json` is now named in a warning, rather than vanishing silently and leaving you wondering where your package went ([#48](https://github.com/donfear/inup/pull/48)).
- Bun's text lockfile `bun.lock` is detected alongside the binary `bun.lockb` ([#48](https://github.com/donfear/inup/pull/48)).

### Changed

- Version data comes from the npm registry only; the jsDelivr layer was removed. When retries are exhausted a package is reported unavailable rather than served from stale data ([#49](https://github.com/donfear/inup/pull/49)).

### Fixed

- `package.json` formatting survives an upgrade: the original indent unit (tabs, two or four spaces) and the presence or absence of a trailing newline are preserved, and the file is left untouched when the result would be byte-identical ([#56](https://github.com/donfear/inup/pull/56)).

## [1.5.6] - 2026-05-30

*The documented keymap becomes the real keymap.*

### Added

- `?` opens a categorized, scrollable overlay of every keyboard shortcut ([#47](https://github.com/donfear/inup/pull/47)).
- `Space` toggles the highlighted package, `g` and `G` jump to the first and last rows, and `j`/`k` work as `↓`/`↑` ([#47](https://github.com/donfear/inup/pull/47)).

### Changed

- Filter state — the `d`/`p`/`o` dependency-type toggles and the vulnerable-only view — persists between sessions, in the same config file as your theme ([#47](https://github.com/donfear/inup/pull/47)).
- A single keymap now drives input handling, the help overlay, the footer hints and the README's key table, so the documented shortcuts can no longer drift from the real ones ([#47](https://github.com/donfear/inup/pull/47)).

## [1.5.5] - 2026-05-16

### Changed

- Brand-colored header and theme-colored package names, with clearer navigation hints in modals ([#42](https://github.com/donfear/inup/pull/42)).

### Fixed

- Interrupting inup left the terminal in the alternate screen with the cursor hidden and raw mode on. The terminal is now restored on normal exit, on Ctrl+C, on SIGINT/SIGTERM and after a crash ([#39](https://github.com/donfear/inup/pull/39)).

## [1.5.3] - 2026-04-20

### Added

- A "Used by" tab in the package info modal, reached with `Tab`, listing which workspace `package.json` files depend on the package ([#36](https://github.com/donfear/inup/pull/36)).

### Changed

- Results stream in batches of 10 rather than 25, with a global cap on in-flight requests, so the first rows appear sooner on a slow connection ([#37](https://github.com/donfear/inup/pull/37)).

## [1.5.2] - 2026-04-19

### Added

- `!` opens a performance panel showing phases, counts, per-batch timings, failed packages and the detected package manager ([#34](https://github.com/donfear/inup/pull/34)).

### Changed

- The npm registry client moved onto an undici connection pool too, cutting per-request overhead ([#35](https://github.com/donfear/inup/pull/35)).

## [1.5.1] - 2026-04-15

### Added

- A dirty git working tree is detected before upgrading and confirmed with a prompt that defaults to declining, so upgrades don't land on top of uncommitted work ([#31](https://github.com/donfear/inup/pull/31)).

## [1.5.0] - 2026-04-14

*Enough context to judge an upgrade before you take it.*

### Added

- Vulnerability audit, against the same npm advisory API that `npm audit` uses. Affected packages carry `[CRIT]`, `[HIGH]`, `[MOD]`, `[LOW]` or `[INFO]` badges in the list, with the advisories and their links in the info modal. It runs in the background while you browse, deduplicated per package, and `s` re-runs it on demand ([#27](https://github.com/donfear/inup/pull/27)).
- Release notes in the info modal (`i`), so you can read what changed without leaving the terminal. They come from the GitHub release page, falling back to the Releases API, then the repository's own `CHANGELOG.md`, and finally the published package's. One version is shown at a time, with `←` and `→` stepping through the releases between yours and the latest ([#29](https://github.com/donfear/inup/pull/29), [#30](https://github.com/donfear/inup/pull/30)).

## [1.4.12] - 2026-03-19

### Fixed

- When jsDelivr had no manifest for an exact version, that version resolved to nothing at all. The npm registry is now used as the fallback ([#26](https://github.com/donfear/inup/pull/26)).

## [1.4.11] - 2026-03-19

### Changed

- The npm registry is the primary source of version data, with jsDelivr demoted to a fallback for exact-version manifests ([#24](https://github.com/donfear/inup/pull/24)).
- Packages stream into the list as they load, and concurrent requests for the same package are deduplicated ([#25](https://github.com/donfear/inup/pull/25)).

### Removed

- The persistent disk cache added in 1.4.5 is no longer wired up, in favor of fresh-by-default results ([#25](https://github.com/donfear/inup/pull/25)).

## [1.4.10] - 2026-03-18

### Added

- `--max-depth <number>` bounds how deep the workspace scan descends, defaulting to `10` ([#21](https://github.com/donfear/inup/pull/21)).

### Changed

- Directory scanning runs in parallel, so large monorepos start faster ([#21](https://github.com/donfear/inup/pull/21)).

## [1.4.9] - 2026-03-17

### Fixed

- Upgrades re-derived a dependency's section by looking it up by name, so peer and optional dependencies could be written into the wrong part of `package.json` — or dropped entirely when the lookup missed ([#20](https://github.com/donfear/inup/pull/20)).

## [1.4.8] - 2026-02-19

### Fixed

- Scroll position and navigation state were computed from the wrong item count, so the selected package could scroll out of view — on resize, and when leaving a search filter ([#18](https://github.com/donfear/inup/pull/18)).

## [1.4.7] - 2026-02-17

### Added

- `--debug` (or `INUP_DEBUG=1`) writes a verbose log to a dated file for troubleshooting ([#17](https://github.com/donfear/inup/pull/17)).

### Changed

- Shorter request timeouts with retry and cache warming, so a single unresponsive package no longer holds up the run ([#17](https://github.com/donfear/inup/pull/17)).

## [1.4.6] - 2026-02-05

### Added

- `gruvbox`, `solarized` and `github` themes, bringing the built-in set to ten ([#15](https://github.com/donfear/inup/pull/15)).

## [1.4.5] - 2026-02-04

### Added

- `-i, --ignore <packages>` skips packages by name or glob (`@babel/*`, `eslint-*`), and the same list can live in a project config file — `.inuprc`, `.inuprc.json` or `inup.config.json` — where it merges with anything passed on the command line ([#13](https://github.com/donfear/inup/pull/13)).
- A persistent on-disk cache for registry data, kept in the per-OS cache directory with a 24-hour lifetime, making repeat runs in the same project near-instant ([#14](https://github.com/donfear/inup/pull/14)).

## [1.4.4] - 2026-01-30

### Changed

- Packages appear as they resolve rather than all at once when the batch finishes ([#12](https://github.com/donfear/inup/pull/12)).

## [1.4.3] - 2026-01-29

### Added

- `d`, `p` and `o` toggle dev, peer and optional dependencies in the list, which now carry `[D]`, `[P]` and `[O]` badges ([#10](https://github.com/donfear/inup/pull/10)).

### Changed

- jsDelivr misses are collected into a single npm fallback request rather than one per package ([#11](https://github.com/donfear/inup/pull/11)).

### Removed

- **Breaking:** `-p, --peer` and `-o, --optional`. Every dependency type is loaded now and toggled from the UI instead ([#10](https://github.com/donfear/inup/pull/10)).

## [1.4.2] - 2026-01-28

### Added

- Themes. `t` opens a selector offering `default`, `catppuccin`, `dracula`, `vsc`, `monokai`, `tokyonight` and `onedark`; the choice is remembered in the per-OS config directory ([#6](https://github.com/donfear/inup/pull/6)).

### Changed

- Navigation stops at the ends of the list instead of wrapping around to the other end ([#6](https://github.com/donfear/inup/pull/6)).
- The layout adapts to the terminal width, truncating long names in the middle instead of overflowing ([#6](https://github.com/donfear/inup/pull/6)).

## [1.4.1] - 2026-01-27

### Added

- `/` starts a search filter — type to narrow the list by name, with the query and match count in the header, and `Esc` to exit ([#5](https://github.com/donfear/inup/pull/5)).

### Changed

- Smoother keyboard navigation: the list scrolls a row at a time instead of jumping ([#4](https://github.com/donfear/inup/pull/4)).

### Fixed

- Patch updates within the same `major.minor` were not detected ([#2](https://github.com/donfear/inup/pull/2)).
- The terminal cursor stayed visible on top of the interactive UI ([#3](https://github.com/donfear/inup/pull/3)).

## [1.4.0] - 2026-01-27

*`pnpm-upgrade-interactive` becomes `inup`, and stops being about pnpm.*

### Added

- npm, yarn, pnpm and bun are all supported. The package manager is read from the `packageManager` field, or failing that the lockfile (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`), shown in the UI, and used to run the matching install after an upgrade. `--package-manager <name>` overrides the detection, and an undetectable project falls back to npm with a warning rather than guessing silently.

### Changed

- **Breaking:** the project is now `inup`. Both the package and the command were renamed from `pnpm-upgrade-interactive` — install with `npm install -g inup` and run `inup`.

## [1.3.8] - 2026-01-24

### Changed

- Faster loading, with redundant progress output and duplicated changelog metadata caching removed ([#10](https://github.com/donfear/pnpm-upgrade-interactive/pull/10)).

## [1.3.6] - 2026-01-24

### Changed

- Version lookups query the npm registry over HTTP instead of shelling out to the package manager, with in-memory caching and concurrent requests — substantially faster on projects with many dependencies ([#8](https://github.com/donfear/pnpm-upgrade-interactive/pull/8)).

## [1.3.4] - 2026-01-23

### Added

- Workspace scanning gained a depth limit, symlink-cycle protection and progress reporting ([#6](https://github.com/donfear/pnpm-upgrade-interactive/pull/6)).

### Fixed

- Scrolling jumped to the wrong position once the list outgrew the viewport ([#6](https://github.com/donfear/pnpm-upgrade-interactive/pull/6)).

## [1.3.3] - 2026-01-22

### Added

- An upgrade summary before confirmation: how many packages, how many `package.json` files they touch, and how many are in-range versus latest-version picks.

### Fixed

- The CLI registered itself as `pnpm-aupgrade-interactive`, so its own help output advertised a command that didn't exist.

## [1.3.1] - 2026-01-21

### Added

- The header states which dependency types are currently on display.
- After a run, inup checks whether a newer version of itself is available and prints the right command to update it.

### Changed

- **Breaking:** the list no longer groups packages by dependency type. Everything appears in one flat list, filtered by the options you passed.

## [1.2.0] - 2026-01-21

### Added

- A package info modal, opened with `i` and closed with `Esc`, showing the description, author, license, download counts and project links ([#4](https://github.com/donfear/pnpm-upgrade-interactive/pull/4)).

### Changed

- **Breaking:** `--include-peer-deps` and `--include-optional-deps` are now `-p, --peer` and `-o, --optional`.
- `--version` reports the installed package's version rather than a hardcoded string.

### Removed

- **Breaking:** `--dry-run`.

## [1.1.0] - 2025-11-17

### Added

- `--include-peer-deps` and `--include-optional-deps` bring those dependency types into the scan; both are off by default ([#1](https://github.com/donfear/pnpm-upgrade-interactive/pull/1)).

## [1.0.5] - 2025-09-29

*`yarn upgrade-interactive`, for a project that isn't using yarn.*

### Added

- Initial release, as `pnpm-upgrade-interactive`: find every `package.json` in a pnpm workspace, ask `pnpm view` for newer versions, pick what to upgrade from an interactive list, and have `pnpm install` run for you afterwards. Built for monorepos, where the alternative is opening a dozen files by hand.

[Unreleased]: https://github.com/donfear/inup/compare/v1.7.1...HEAD
[1.7.1]: https://github.com/donfear/inup/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/donfear/inup/compare/v1.6.11...v1.7.0
[1.6.11]: https://github.com/donfear/inup/compare/v1.6.10...v1.6.11
[1.6.10]: https://github.com/donfear/inup/compare/v1.6.9...v1.6.10
[1.6.9]: https://github.com/donfear/inup/compare/v1.6.8...v1.6.9
[1.6.8]: https://github.com/donfear/inup/compare/v1.6.7...v1.6.8
[1.6.7]: https://github.com/donfear/inup/compare/v1.6.6...v1.6.7
[1.6.4]: https://github.com/donfear/inup/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/donfear/inup/compare/v1.6.2...v1.6.3
[1.6.1]: https://github.com/donfear/inup/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/donfear/inup/compare/v1.5.6...v1.6.0
[1.5.6]: https://github.com/donfear/inup/compare/v1.5.5...v1.5.6
[1.5.5]: https://github.com/donfear/inup/compare/v1.5.4...v1.5.5
[1.5.3]: https://github.com/donfear/inup/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/donfear/inup/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/donfear/inup/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/donfear/inup/compare/v1.4.12...v1.5.0
[1.4.12]: https://github.com/donfear/inup/compare/v1.4.11...v1.4.12
[1.4.11]: https://github.com/donfear/inup/compare/v1.4.10...v1.4.11
[1.4.10]: https://github.com/donfear/inup/compare/v1.4.9...v1.4.10
[1.4.9]: https://github.com/donfear/inup/compare/v1.4.8...v1.4.9
[1.4.8]: https://github.com/donfear/inup/compare/v1.4.7...v1.4.8
[1.4.7]: https://github.com/donfear/inup/compare/v1.4.6...v1.4.7
[1.4.6]: https://github.com/donfear/inup/compare/v1.4.5...v1.4.6
[1.4.5]: https://github.com/donfear/inup/compare/v1.4.4...v1.4.5
[1.4.4]: https://github.com/donfear/inup/compare/v1.4.3...v1.4.4
[1.4.3]: https://github.com/donfear/inup/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/donfear/inup/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/donfear/inup/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/donfear/inup/compare/v1.3.8...v1.4.0
[1.3.8]: https://github.com/donfear/inup/compare/v1.3.7...v1.3.8
[1.3.6]: https://github.com/donfear/inup/compare/v1.3.5...v1.3.6
[1.3.4]: https://github.com/donfear/inup/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/donfear/inup/compare/v1.3.2...v1.3.3
[1.3.1]: https://github.com/donfear/inup/compare/v1.2.1...v1.3.1
[1.2.0]: https://github.com/donfear/inup/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/donfear/inup/compare/v1.0.6...v1.1.0
[1.0.5]: https://github.com/donfear/inup/releases/tag/v1.0.5
