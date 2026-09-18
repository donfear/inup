---
title: GitHub Action
description: Automate dependency upgrades with donfear/inup@v1 — one rolling pull request with safe upgrades applied, updated on every scheduled run.
order: 60
updated: 2026-07-06
---

Automate dependency upgrades for your GitHub repo: run inup on a schedule and get **one rolling pull request** with safe upgrades applied. Re-runs update the same PR instead of opening new ones.

Add this workflow to **your** repo:

```yaml
# .github/workflows/inup.yml
name: inup
on:
  schedule:
    - cron: '17 5 * * *' # daily around 05:17 UTC
  workflow_dispatch: {}

permissions:
  contents: write
  pull-requests: write

jobs:
  upgrade:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: donfear/inup@v1
        with:
          target: minor # minor (default) | patch | latest
```

That's it. Also enable Settings → Actions → General → **Workflow permissions** → **"Allow GitHub Actions to create and approve pull requests"** so the action can open the PR.

> Scheduled workflows are not real-time timers: GitHub documents that `schedule` runs can be delayed during busy periods, and the start of each hour is especially busy. Schedule earlier than you need and avoid `:00` cron minutes.

## What the action creates

When inup finds applicable upgrades, the workflow commits the changed manifest/lockfile and opens or updates one pull request. The PR body contains a summary line, the list of upgrades applied in the PR, and a full table of available updates — including whether a major is available and whether an upgrade fixes a known vulnerability.

Catalog-sourced upgrades (pnpm `catalog:` deps) are applied to `pnpm-workspace.yaml` and marked `catalog:<name>` in the PR body so reviewers know which file the diff touches.

## Commit as you, not the bot

By default the upgrade commit is authored by `github-actions[bot]`. To attribute it to **you**, store your name/email as repo secrets and pass `committer`/`author`:

```yaml
      - uses: donfear/inup@v1
        with:
          committer: ${{ secrets.GH_USERNAME }} <${{ secrets.GH_EMAIL }}>
          author: ${{ secrets.GH_USERNAME }} <${{ secrets.GH_EMAIL }}>
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `target` | `minor` | How far to bump: `minor` (in-range), `patch`, or `latest` (includes majors) |
| `directory` | `.` | Directory to run in |
| `package-manager` | _(auto)_ | Force `npm`/`yarn`/`pnpm`/`bun`; empty auto-detects from the lockfile |
| `node-version` | `22` | Node.js version for the run (minimum `22.19`) |
| `inup-version` | `latest` | inup version to run (pin for reproducible runs) |
| `pr-branch` | `inup/dependency-upgrades` | Branch for the rolling PR |
| `pr-title` | `chore(deps): dependency upgrades` | PR title |
| `commit-message` | `chore(deps): upgrade dependencies via inup` | Commit message |
| `base` | _(default branch)_ | Base branch the PR targets |
| `labels` | `dependencies` | Labels to apply to the PR |
| `token` | `${{ github.token }}` | Token to push + open the PR. Pass a PAT to also trigger CI on the PR |
| `committer` | `github-actions[bot]` | Commit committer, as `Name <email>` |
| `author` | _(triggering user)_ | Commit author, as `Name <email>` |

## Outputs

`outdated`, `vulnerable`, `pull-request-number`.

`@v1` floats to the latest `1.x` release; pin to a specific version or a SHA for reproducible runs. The action honors your [`.inuprc`](../configuration/) (`ignore`, `exclude`, `scanDirs`).
