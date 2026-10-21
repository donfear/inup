# Benchmarks

How long inup takes to find outdated dependencies, next to the tools people use for the same job: [npm-check-updates](https://github.com/raineorshine/npm-check-updates), [taze](https://github.com/antfu-collective/taze), [npm-check](https://github.com/dylang/npm-check), and the package manager's own `npm outdated` or `pnpm outdated`. The [Benchmark workflow](../../.github/workflows/benchmark.yml) produces the results below and the chart in the README.

## What is measured

Every tool answers the same question: which dependencies, in every `package.json` of the repository, have a newer version than the one declared? Each one runs headless with the flags that make it check every dependency against its latest version and change nothing (the exact commands are listed with each result). The time runs from launch to exit, with the output discarded.

- **First run**: every cache the tool keeps is emptied before each run. Each run gets a fresh home folder, fresh XDG cache, config and data folders, and a fresh temp folder, so nothing is left from the run before. It matches a first run on a new machine, or a CI job without a cache, with the tool itself already installed.
- **Repeat run**: the tool keeps its caches, filled by an untimed warmup run. This is the second run on your own machine.

The interactive pickers and installing the upgrades are not measured. inup's picker loads versions with the same lookups as the headless run.

## The repositories

Public repositories, each pinned to a commit so every run checks the same manifests:

- [expressjs/express](https://github.com/expressjs/express): one package, npm
- [vuejs/core](https://github.com/vuejs/core): a pnpm workspace with about 20 packages
- [TanStack/query](https://github.com/TanStack/query): a pnpm workspace with about 100 packages, examples included

Each repository is installed (`npm install` or `pnpm install --frozen-lockfile`, scripts off) before any timing, because `npm outdated`, `pnpm outdated` and npm-check read `node_modules`. pnpm runs at the version in the repository's `packageManager` field.

## How it runs

- [hyperfine](https://github.com/sharkdp/hyperfine) times each tool: one warmup run, then the timed runs. The tables show the median, and the details below them show the standard deviation and the fastest and slowest runs.
- Each repository runs as its own job on a GitHub-hosted Ubuntu runner, and the tools run one after another on that runner. Compare tools within a column. Two columns, or two workflow runs, may come from different machines and network conditions.
- inup is built from the commit being tested. The other tools are the latest versions on npm when the workflow runs, and the results list each version.
- Before any timing, each tool runs once and must exit successfully and find updates. The **Updates found** column shows what each tool reported, as a check that they all did the full job. Counts differ because tools group results differently: `pnpm outdated` lists each package once for the whole workspace, while the others list it once for each `package.json` that declares it. npm-check prints only a table, so it has no count.

## Where tools differ

- inup also checks every dependency for known vulnerabilities during the run, and its times include that check.
- taze looks versions up through its own metadata service (`npm.antfu.dev`) by default. On a repeat run it reuses what it fetched in the last 30 minutes without contacting the registry. inup revalidates each package with the registry on every run, so a version published a minute ago is already in the report.
- npm-check-updates keeps no cache by default, so its repeat runs take as long as its first runs.
- npm-check doesn't support workspaces, so it only runs on the single-package repository.

## Run it yourself

You need [hyperfine](https://github.com/sharkdp/hyperfine#installation) and network access:

```bash
pnpm bench:compare --fixture vue-core --runs 10   # writes bench-results/vue-core.json
node scripts/bench-report.mjs bench-results/*.json  # rewrites the README section, this page and the chart
```

Fixtures: `express`, `vue-core`, `tanstack-query`. Times from your machine and network will differ from the runner's.

## Results

<!-- BENCHMARK:START -->
### expressjs/express

[`expressjs/express@0dee2c5`](https://github.com/expressjs/express/tree/0dee2c52c7c873498f8ed7d8ee4ddd0a04d3ada8) · npm · 1 package.json · 44 dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.8.7 (77f554e) | **0.35 s** ± 0.01<br><sub>0.34–0.38</sub> | 0.31 s ± 0.01<br><sub>0.30–0.34</sub> | 22 |
| npm-check-updates | 23.1.1 | 0.66 s ± 0.03<br><sub>0.63–0.72</sub> | 0.69 s ± 0.03<br><sub>0.65–0.73</sub> | 21 |
| taze | 21.3.0 | 0.65 s ± 0.55<br><sub>0.48–2.30</sub> | **0.21 s** ± 0.00<br><sub>0.21–0.22</sub> | 21 |
| npm-check | 6.0.1 | 1.07 s ± 0.03<br><sub>1.04–1.15</sub> | 1.09 s ± 0.04<br><sub>1.05–1.16</sub> | — |
| npm outdated | 11.19.1 | 0.90 s ± 0.01<br><sub>0.89–0.93</sub> | 0.69 s ± 0.01<br><sub>0.67–0.70</sub> | 13 |

Median, ± standard deviation, min–max, over 10 runs. Measured 21 Oct 2026 on GitHub Actions ubuntu24 20261018.339.1 · Linux 7.0.0-1017-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.22.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/39603646627).

Commands, run in the repository root:

```sh
inup --json
ncu --jsonUpgraded
taze major --include-locked --no-github-actions --no-node-version --json
npm-check --skip-unused
npm outdated --json
```

### vuejs/core

[`vuejs/core@65eae17`](https://github.com/vuejs/core/tree/65eae178383289b6a9f93505ab85017460f72395) · pnpm@12.11.2 · 22 package.json files · 69 dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.8.7 (77f554e) | **0.95 s** ± 0.02<br><sub>0.91–0.97</sub> | 0.44 s ± 0.02<br><sub>0.43–0.51</sub> | 26 |
| npm-check-updates | 23.1.1 | 4.36 s ± 0.19<br><sub>4.21–4.76</sub> | 4.37 s ± 0.26<br><sub>4.21–4.96</sub> | 25 |
| taze | 21.3.0 | 1.46 s ± 0.63<br><sub>1.10–2.83</sub> | 0.53 s ± 0.01<br><sub>0.52–0.55</sub> | 25 |
| pnpm outdated | 12.11.2 | 1.45 s ± 0.18<br><sub>1.42–1.96</sub> | **0.21 s** ± 0.01<br><sub>0.20–0.22</sub> | 27 |
| npm-check | — | not run: no workspace support | | |

Median, ± standard deviation, min–max, over 10 runs. Measured 21 Oct 2026 on GitHub Actions ubuntu24 20261018.339.1 · Linux 7.0.0-1017-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.22.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/39603646627).

Commands, run in the repository root:

```sh
inup --json
ncu --jsonUpgraded --workspaces
taze major --recursive --include-locked --no-github-actions --no-node-version --json
pnpm outdated --recursive --format json
```

### TanStack/query

[`TanStack/query@ce77be5`](https://github.com/TanStack/query/tree/ce77be5e15c695df9d4d9122caf9256d334433ba) · pnpm@12.4.2 · 105 package.json files · 190 dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.8.7 (77f554e) | **2.68 s** ± 0.04<br><sub>2.62–2.74</sub> | **0.64 s** ± 0.08<br><sub>0.61–0.90</sub> | 606 |
| npm-check-updates | 23.1.1 | 12.4 s ± 0.86<br><sub>11.50–14.49</sub> | 12.1 s ± 1.10<br><sub>11.18–15.14</sub> | 588 |
| taze | 21.3.0 | 9.84 s ± 0.70<br><sub>8.61–10.70</sub> | 6.67 s ± 0.07<br><sub>6.59–6.85</sub> | 601 |
| pnpm outdated | 12.4.2 | 2.99 s ± 0.08<br><sub>2.80–3.08</sub> | 4.70 s ± 0.09<br><sub>4.62–4.90</sub> | 99 |
| npm-check | — | not run: no workspace support | | |

Median, ± standard deviation, min–max, over 10 runs. Measured 21 Oct 2026 on GitHub Actions ubuntu24 20261018.339.1 · Linux 7.0.0-1017-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.22.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/39603646627).

Commands, run in the repository root:

```sh
inup --json
ncu --jsonUpgraded --workspaces
taze major --recursive --include-locked --no-github-actions --no-node-version --json
pnpm outdated --recursive --format json
```
<!-- BENCHMARK:END -->
