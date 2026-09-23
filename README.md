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
| `m` | Select all minor/patch updates, except peers |
| `l` | Select all latest updates (including major), except peers |
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

`minor` stays within existing version ranges. Use `patch` for patch updates only, or `latest` to include major upgrades.

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
[![Tests](https://img.shields.io/badge/tests-1780_passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/donfear/inup/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen?style=for-the-badge)](https://github.com/donfear/inup/actions/workflows/ci.yml)
<!-- TEST-BADGES:END -->

</details>
