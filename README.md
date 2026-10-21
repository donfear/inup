<p align="center">
  <img src="docs/brand/inup-logo.webp" alt="inup logo" width="170">
</p>

# inup

**Dependency updates. Your call.**

[![npm version](https://img.shields.io/npm/v/inup?logo=npm&logoColor=%23CB3837&style=for-the-badge&color=crimson)](https://www.npmjs.com/package/inup)
[![Downloads](https://img.shields.io/npm/dm/inup?style=for-the-badge&color=646CFF&logoColor=white)](https://www.npmjs.com/package/inup)
[![CI](https://img.shields.io/github/actions/workflow/status/donfear/inup/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/donfear/inup/actions/workflows/ci.yml)

See what's outdated, read what changed, and pick what to upgrade. Works with **npm, pnpm, Yarn, and Bun**.

Run this in your project:

```bash
npx inup
```

Requires Node.js 22.19+. No configuration needed.

![inup terminal picker showing dependency versions and upgrade selections](docs/demo/interactive-upgrade.gif)

## Pick your updates

Move with `↑` / `↓`, select with `Space`, and press `Enter` to apply. Your dependency files stay untouched until you confirm. Then inup writes the selected versions and runs your package manager's install to update the lockfile.

| Want to… | Press |
| --- | --- |
| Find a package | `/` |
| Read its changelog | `i` |
| Check known vulnerabilities and available fixes | `s` |
| Select updates within your existing version ranges | `m` |
| Choose an in-range update or the latest version | `←` / `→` |

Review the diff and run your tests after upgrading.

<details>
<summary>All keyboard shortcuts</summary>

<!-- KEYS:START -->
| Key | Action |
|-----|--------|
| `↑ / k` | Move up |
| `↓ / j` | Move down |
| `g / Home` | Jump to the first package |
| `G / End` | Jump to the last package |
| `PgUp` | Move up one page |
| `PgDn` | Move down one page |
| `←` | Cycle selection left (latest → range → none) |
| `→` | Cycle selection right (none → range → latest) |
| `Space` | Toggle the current package on/off |
| `m` | Select all minor/patch updates, except peers and patched packages |
| `l` | Select all latest updates (including major), except peers and patched packages |
| `u` | Unselect all packages |
| `Enter` | Confirm selection and upgrade |
| `/` | Search packages by name |
| `d` | Toggle devDependencies |
| `p` | Toggle peerDependencies |
| `o` | Toggle optionalDependencies |
| `s` | Run the vulnerability audit |
| `v` | Show only vulnerable packages |
| `c` | Show packages held back by the release-age cooldown |
| `Esc` | Clear the active search filter |
| `i` | View package details and changelog |
| `t` | Change the color theme |
| `?` | Show this help |
| `!` | Show the performance/debug panel |
| `q` | Quit without changes |
<!-- KEYS:END -->

</details>

## One project or a whole monorepo

inup detects your package manager and finds dependencies across workspaces. Private registries use your `.npmrc`. pnpm catalog entries are updated in `pnpm-workspace.yaml`.

Need to leave a package alone? Run `npx inup --ignore "react,react-dom"`, or save your rules in [`.inuprc`](docs/guide/configuration.md).

<!-- BENCHMARK:START -->
## Speed

How long each tool takes to list every outdated dependency, from launch to exit, on public repositories pinned to a commit. Lower is better.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/benchmark/speed-dark.svg">
  <img alt="First-run times in seconds. expressjs/express: inup 0.35 s, npm-check-updates 0.66 s, taze 0.65 s, npm-check 1.07 s, npm outdated 0.90 s; vuejs/core: inup 0.95 s, npm-check-updates 4.36 s, taze 1.46 s, pnpm outdated 1.45 s; TanStack/query: inup 2.68 s, npm-check-updates 12.4 s, taze 9.84 s, pnpm outdated 2.99 s" src="docs/benchmark/speed-light.svg">
</picture>

| First run | [expressjs/express](https://github.com/expressjs/express/tree/0dee2c52c7c873498f8ed7d8ee4ddd0a04d3ada8)<br><sub>1 package.json · 44 dependencies</sub> | [vuejs/core](https://github.com/vuejs/core/tree/65eae178383289b6a9f93505ab85017460f72395)<br><sub>22 package.json files · 69 dependencies</sub> | [TanStack/query](https://github.com/TanStack/query/tree/ce77be5e15c695df9d4d9122caf9256d334433ba)<br><sub>105 package.json files · 190 dependencies</sub> |
| :-- | --: | --: | --: |
| inup | **0.35 s** | **0.95 s** | **2.68 s** |
| npm-check-updates | 0.66 s | 4.36 s | 12.4 s |
| taze | 0.65 s | 1.46 s | 9.84 s |
| npm-check | 1.07 s | — | — |
| npm outdated / pnpm outdated | 0.90 s | 1.45 s | 2.99 s |

| Repeat run | [expressjs/express](https://github.com/expressjs/express/tree/0dee2c52c7c873498f8ed7d8ee4ddd0a04d3ada8) | [vuejs/core](https://github.com/vuejs/core/tree/65eae178383289b6a9f93505ab85017460f72395) | [TanStack/query](https://github.com/TanStack/query/tree/ce77be5e15c695df9d4d9122caf9256d334433ba) |
| :-- | --: | --: | --: |
| inup | 0.31 s | 0.44 s | **0.64 s** |
| npm-check-updates | 0.69 s | 4.37 s | 12.1 s |
| taze | **0.21 s** | 0.53 s | 6.67 s |
| npm-check | 1.09 s | — | — |
| npm outdated / pnpm outdated | 0.69 s | **0.21 s** | 4.70 s |

<sub>First run: every cache the tool keeps is emptied before each run. Repeat run: caches kept. Median of 10 runs per tool with [hyperfine](https://github.com/sharkdp/hyperfine) 1.20.0 on GitHub Actions ubuntu24 20261018.339.1, 4 CPUs, Node v24.22.0, 21 Oct 2026. inup's times include its vulnerability check, which the other tools don't run. Fastest in **bold**.</sub>

[How it's measured, tool versions and exact commands](docs/guide/benchmarks.md)
<!-- BENCHMARK:END -->

## Let a release age before you take it

A version published an hour ago is the one most likely to be a compromised release nobody has caught yet. Give releases a cooldown and inup stops offering anything younger — in the picker, in reports, and in `--apply`:

```bash
npx inup --minimum-release-age 10080   # nothing published in the last 7 days
```

Keep it in [`.inuprc`](docs/guide/configuration.md) as `minimumReleaseAge` (minutes, the same name and unit pnpm uses), with `minimumReleaseAgeExclude` for your own packages.

inup tells you what it held back rather than quietly showing you fewer updates, so a package waiting out its cooldown never looks the same as a package that is up to date.

Registries that don't publish release times are unaffected — the cooldown only acts on evidence it actually has.

## GitHub Action: one PR, kept up to date

Let inup run on a schedule. It opens a dependency-update pull request and refreshes that same PR on later runs. You review and merge when you're ready.

<details>
<summary>Add the workflow to your repo</summary>

Save this as `.github/workflows/inup.yml`:

```yaml
name: Dependency updates

on:
  schedule:
    - cron: '17 5 * * 1' # Mondays at 05:17 UTC
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  upgrade:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: donfear/inup@v1
        with:
          target: minor
```

In your repo's **Settings → Actions → General → Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**.

`minor` stays within existing version ranges, following each range's operator: `^0.2.3` stays on `0.2.x` and `~1.2.3` on `1.2.x` ([full rule](docs/guide/ci.md#--apply)). Use `patch` for patch updates only, or `latest` to include major upgrades.

If you need the PR to trigger CI, pass a personal access token through the action's `token` input. See the [Action guide](docs/guide/github-action.md) for all inputs and outputs.

</details>

## Native core

inup fetches and parses registry data with a native core written in Rust: on large projects it uses about half the CPU and a quarter less memory, and the list stays responsive while packages load. It's on by default.

inup itself installs no native code. The first interactive run downloads the core for your platform (about 1.5 MB), checks it against the hash built into your copy of inup and caches it; from the next run on, inup uses it, re-checking the cached file each time. A core that doesn't match is never loaded, whichever registry served it. Scripted runs (`--json`, `--check`, `--apply`, CI) use the core once it's cached but never download it themselves, so they finish without waiting on it. Supported on macOS, Linux and Windows (x64 and arm64). If it can't be used, inup quietly falls back to the standard core.

```bash
npx inup --no-native  # standard core for this run
npx inup --native     # native core, downloading it even in a scripted run
```

To turn it off for a project, add `"native": false` to [`.inuprc`](docs/guide/configuration.md#native).

## Using it in scripts?

```bash
npx inup --check  # Exit 1 if updates exist; don't change files
npx inup --json   # Print a JSON report; don't change files
npx inup --apply  # Apply in-range updates and run install
```

[CLI reference](docs/guide/cli.md) · [CI guide](docs/guide/ci.md) · [Troubleshooting](docs/guide/faq.md)

---

No telemetry or tracking. inup contacts your package registry for metadata and security advisories, npm for download counts, and GitHub for release notes.

[Documentation](docs/guide/README.md) · [Changelog](CHANGELOG.md) · [Report a bug](https://github.com/donfear/inup/issues) · [MIT license](LICENSE)

<details>
<summary>Tests and coverage</summary>

<!-- TEST-BADGES:START -->
[![Tests](https://img.shields.io/badge/tests-1986_passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/donfear/inup/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen?style=for-the-badge)](https://github.com/donfear/inup/actions/workflows/ci.yml)
<!-- TEST-BADGES:END -->

</details>
