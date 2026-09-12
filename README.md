<p align="center">
  <a href="https://donfear.github.io/inup/"><img src="docs/brand/inup-logo.webp" alt="inup logo" width="170"></a>
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
| `g` | Jump to the first package |
| `G` | Jump to the last package |
| `←` | Cycle selection left (none → range → latest) |
| `→` | Cycle selection right (none → range → latest) |
| `Space` | Toggle the current package on/off |
| `m` | Select all minor/patch updates |
| `l` | Select all latest updates (including major) |
| `u` | Unselect all packages |
| `Enter` | Confirm selection and upgrade |
| `/` | Search packages by name |
| `d` | Toggle devDependencies |
| `p` | Toggle peerDependencies |
| `o` | Toggle optionalDependencies |
| `s` | Run the vulnerability audit |
| `v` | Show only vulnerable packages |
| `Esc` | Clear the active search filter |
| `i` | View package details and changelog |
| `t` | Change the color theme |
| `?` | Show this help |
| `!` | Show the performance/debug panel |
<!-- KEYS:END -->

</details>

## One project or a whole monorepo

inup detects your package manager and finds dependencies across workspaces. Private registries use your `.npmrc`. pnpm catalog entries are updated in `pnpm-workspace.yaml`.

Need to leave a package alone? Run `npx inup --ignore "react,react-dom"`, or save your rules in [`.inuprc`](https://donfear.github.io/inup/docs/configuration/).

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

If you need the PR to trigger CI, pass a personal access token through the action's `token` input. See the [Action guide](https://donfear.github.io/inup/docs/github-action/) for all inputs and outputs.

</details>

## Using it in scripts?

```bash
npx inup --check  # Exit 1 if updates exist; don't change files
npx inup --json   # Print a JSON report; don't change files
npx inup --apply  # Apply in-range updates and run install
```

[CLI reference](https://donfear.github.io/inup/docs/cli/) · [CI guide](https://donfear.github.io/inup/docs/ci/) · [Troubleshooting](https://donfear.github.io/inup/docs/faq/)

---

No telemetry or tracking. inup contacts your package registry for metadata, npm for security advisories and download counts, and GitHub for release notes.

[Documentation](https://donfear.github.io/inup/) · [Changelog](CHANGELOG.md) · [Report a bug](https://github.com/donfear/inup/issues) · [MIT license](LICENSE)

<details>
<summary>Tests and coverage</summary>

<!-- TEST-BADGES:START -->
[![Tests](https://img.shields.io/badge/tests-1345_passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/donfear/inup/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen?style=for-the-badge)](https://github.com/donfear/inup/actions/workflows/ci.yml)
<!-- TEST-BADGES:END -->

</details>

<!-- Feature cards consumed by the website. Order matches its card icons. -->
<!-- FEATURES:START -->
<!--
- **Check security before updating** — See known vulnerabilities beside a package and whether an available update resolves them.
- **Find a package** — Press / to search the list by name.
- **Focus the list** — Show or hide development, peer, and optional dependencies as you browse.
- **Read the release notes** — Press i to see package details and changelogs in the terminal.
- **Select updates in bulk** — Select updates within your existing version ranges, or include the latest majors.
- **Choose your version** — Pick an in-range update or the latest version for each package.
-->
<!-- FEATURES:END -->
