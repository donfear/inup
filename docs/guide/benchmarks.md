# Benchmarks

How long inup takes to find outdated dependencies, next to the tools people use for the same job: [npm-check-updates](https://github.com/raineorshine/npm-check-updates), [taze](https://github.com/antfu-collective/taze), [syncpack](https://github.com/JamieMason/syncpack), [npm-check](https://github.com/dylang/npm-check), and the package manager's own `npm outdated`, `pnpm outdated` or `bun outdated`. The [Benchmark workflow](../../.github/workflows/benchmark.yml) produces the results below and the chart in the README.

## What is measured

Two things: how long each tool takes to list every outdated dependency, and how long its interactive picker takes to load every update.

### Listing outdated dependencies

Every tool answers the same question: which dependencies, in every `package.json` of the repository, have a newer version than the one declared? Each one runs headless with the flags that make it check every dependency against its latest version and change nothing (the exact commands are listed with each result). The time runs from launch to exit, with the output discarded.

- **First run**: every cache the tool keeps is emptied before each run. Each run gets a fresh home folder, fresh XDG cache, config and data folders, and a fresh temp folder, so nothing is left from the run before. It matches a first run on a new machine, or a CI job without a cache, with the tool itself already installed.
- **Repeat run**: the tool keeps its caches, filled by an untimed warmup run. This is the second run on your own machine.

### Opening the picker

Each tool that has an interactive list of updates opens it in a terminal of 160 columns by 50 rows: inup, `yarn upgrade-interactive`, `pnpm update --interactive --latest`, `bun update --interactive`, taze, syncpack, npm-check and npm-check-updates. The time runs from launch until the picker has every update loaded, and nothing is selected or installed.

"Loaded" is the last thing the picker draws on screen or writes to its cache before it stays quiet for 5 seconds. A picker can finish drawing the rows on screen and keep fetching the rest. `yarn upgrade-interactive` on backstage, for one, stops drawing after about 2.5 seconds and keeps fetching for several more. Counting cache writes includes that work. The 5 quiet seconds are not part of the time.

First and repeat runs work as for listing. The pickers run in rounds, each tool once per round, so a slow spell on the network affects them all alike.

Installing the upgrades is not measured.

## The repositories

Public repositories, each pinned to a commit so every run checks the same manifests:

- [expressjs/express](https://github.com/expressjs/express): one package, npm
- [vuejs/core](https://github.com/vuejs/core): a pnpm workspace with about 20 packages
- [TanStack/query](https://github.com/TanStack/query): a pnpm workspace with about 100 packages, examples included
- [vendurehq/vendure](https://github.com/vendurehq/vendure): a Bun workspace with about 50 packages
- [backstage/backstage](https://github.com/backstage/backstage): a Yarn 4 workspace with about 270 packages and 590 dependencies

Each repository is installed with its own package manager, with install scripts off, before any timing, because `npm outdated`, `pnpm outdated`, `bun outdated` and npm-check read `node_modules`. pnpm runs at the version in the repository's `packageManager` field, Yarn as the release the repository commits, and Bun at its latest version.

## How it runs

- [hyperfine](https://github.com/sharkdp/hyperfine) times each tool's listing, and the benchmark script times the pickers: one warmup run, then the timed runs. The tables show the median, and the details below them show the standard deviation and the fastest and slowest runs.
- Each repository runs as its own job on a GitHub-hosted Ubuntu runner, and the tools run one after another on that runner. Compare tools within a column. Two columns, or two workflow runs, may come from different machines and network conditions.
- inup is built from the commit being tested, native (Rust) core included (`pnpm build:all`), so every inup run uses the native core. The other tools are the latest versions on npm when the workflow runs, and the results list each version.
- Before any timing, each tool runs once and must exit successfully and find updates. The **Updates found** column shows what each tool reported, as a check that they all did the full job. Counts differ because tools group results differently: `pnpm outdated` lists each package once for the whole workspace, syncpack lists each version of a dependency once however many `package.json` files share it, and the others list a dependency once for each `package.json` that declares it. npm-check prints only a table, so it has no count.

## Where tools differ

- inup checks every dependency for known vulnerabilities by default. None of the other tools does, so inup runs here with `--no-audit`. The check is one request to npm's advisory service, which takes about 0.2 seconds to answer: on a small repository a normal run takes about that much longer, and on a large one the check runs while the registry lookups do.
- inup runs on its native core here. A fresh `npm i inup` doesn't include it: inup downloads it (about 1.5 MB) the first time you open the picker and uses it on every run after that, `--json` included. Until then inup runs on its TypeScript core.
- taze looks versions up through its own metadata service (`npm.antfu.dev`) by default. On a repeat run it reuses what it fetched in the last 30 minutes without contacting the registry. inup revalidates each package with the registry on every run, so a version published a minute ago is already in the report.
- npm-check-updates keeps no cache by default, so its repeat runs take as long as its first runs.
- syncpack shows how old each version is, so it downloads each package's full registry document, publish dates included, which is several times larger than the version list the other tools ask for. On a repeat run it reuses what it fetched in the last 30 minutes.
- `bun outdated` reuses registry responses for as long as the registry's cache headers allow (5 minutes on registry.npmjs.org), so its repeat runs make no requests.
- npm-check doesn't support workspaces, so it only runs on the single-package repository.
- With `--workspaces`, npm-check-updates' picker shows one `package.json` at a time and fetches the next after you answer, so its picker only runs on the single-package repository.
- Yarn 2 and later has no command that lists updates outside `yarn upgrade-interactive`, so the Yarn repository has no package-manager row in the listing tables. npm has no interactive update.

## Run it yourself

You need [hyperfine](https://github.com/sharkdp/hyperfine#installation), `python3` (for the pickers' terminal) and network access, on macOS or Linux:

```bash
pnpm bench:compare --fixture vue-core --runs 10   # writes bench-results/vue-core.json
node scripts/bench-report.mjs bench-results/*.json  # rewrites the README section, this page and the chart
```

Fixtures: `express`, `vue-core`, `tanstack-query`, `vendure`, `backstage`. Times from your machine and network will differ from the runner's.

To time inup on its native core, as the workflow does, build the core first with `pnpm native:build` (needs [Rust](https://rustup.rs)). Without it inup runs on its TypeScript core, and the results say which one ran.

## Results

<!-- BENCHMARK:START -->
### expressjs/express

[`expressjs/express@0dee2c5`](https://github.com/expressjs/express/tree/0dee2c52c7c873498f8ed7d8ee4ddd0a04d3ada8) · npm · 1 package.json · 44 dependencies

Median, ± standard deviation, min–max, over 10 runs. Measured 14 Nov 2026 on GitHub Actions ubuntu24 20261111.370.1 · Linux 7.0.0-1017-azure · AMD EPYC 9V74 80-Core Processor · 4 CPUs · 16 GB · Node v24.22.2 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/43582621064).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.9.1 (5e30e59) | **0.25 s** ± 0.01<br><sub>0.25–0.28</sub> | 0.17 s ± 0.00<br><sub>0.16–0.17</sub> | 26 |
| npm-check-updates | 23.1.1 | 0.61 s ± 0.03<br><sub>0.58–0.69</sub> | 0.61 s ± 0.03<br><sub>0.59–0.69</sub> | 26 |
| taze | 21.3.0 | 0.49 s ± 0.40<br><sub>0.45–1.77</sub> | 0.16 s ± 0.00<br><sub>0.16–0.16</sub> | 25 |
| syncpack | 15.3.3 | 0.26 s ± 0.01<br><sub>0.25–0.28</sub> | **0.04 s** ± 0.00<br><sub>0.04–0.04</sub> | 26 |
| npm-check | 6.0.1 | 0.96 s ± 0.02<br><sub>0.93–0.98</sub> | 0.97 s ± 0.03<br><sub>0.93–1.02</sub> | — |
| npm outdated | 11.19.1 | 0.74 s ± 0.01<br><sub>0.72–0.77</sub> | 0.54 s ± 0.07<br><sub>0.53–0.77</sub> | 15 |

Commands, run in the repository root:

```sh
inup --json --no-audit
ncu --jsonUpgraded
taze major --include-locked --no-github-actions --no-node-version --json
syncpack update --check
npm-check --skip-unused
npm outdated --json
```

#### Opening the picker

| Tool | Version | First run | Repeat run |
| :-- | :-- | --: | --: |
| inup | 1.9.1 (5e30e59) | 0.34 s ± 0.03<br><sub>0.32–0.41</sub> | 0.26 s ± 0.03<br><sub>0.25–0.34</sub> |
| npm-check-updates | 23.1.1 | 0.60 s ± 0.01<br><sub>0.58–0.62</sub> | 0.60 s ± 0.02<br><sub>0.59–0.66</sub> |
| taze | 21.3.0 | 1.34 s ± 0.77<br><sub>0.65–2.68</sub> | **0.18 s** ± 0.00<br><sub>0.17–0.18</sub> |
| syncpack | 15.3.3 | **0.28 s** ± 0.02<br><sub>0.23–0.30</sub> | 0.26 s ± 0.02<br><sub>0.24–0.30</sub> |
| npm-check | 6.0.1 | 0.98 s ± 0.05<br><sub>0.94–1.07</sub> | 0.98 s ± 0.03<br><sub>0.93–1.03</sub> |
| npm update -i | — | not run: npm has no interactive update |  |

Commands, run in the repository root in a 160×50 terminal:

```sh
inup --no-audit
ncu --interactive
taze major --interactive --include-locked --no-github-actions --no-node-version
syncpack update --interactive
npm-check --update --skip-unused
```

### vuejs/core

[`vuejs/core@65eae17`](https://github.com/vuejs/core/tree/65eae178383289b6a9f93505ab85017460f72395) · pnpm@12.11.2 · 22 package.json files · 69 dependencies

Median, ± standard deviation, min–max, over 10 runs. Measured 14 Nov 2026 on GitHub Actions ubuntu24 20261111.370.1 · Linux 7.0.0-1017-azure · INTEL(R) XEON(R) PLATINUM 8573C · 4 CPUs · 16 GB · Node v24.22.2 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/43582621064).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.9.1 (5e30e59) | **0.57 s** ± 0.07<br><sub>0.48–0.71</sub> | 0.21 s ± 0.04<br><sub>0.20–0.33</sub> | 40 |
| npm-check-updates | 23.1.1 | 3.23 s ± 0.14<br><sub>2.98–3.39</sub> | 3.14 s ± 0.15<br><sub>2.80–3.30</sub> | 39 |
| taze | 21.3.0 | 1.17 s ± 0.53<br><sub>1.05–2.48</sub> | 0.45 s ± 0.01<br><sub>0.44–0.45</sub> | 41 |
| syncpack | 15.3.3 | 0.86 s ± 0.03<br><sub>0.83–0.92</sub> | **0.15 s** ± 0.00<br><sub>0.15–0.16</sub> | 37 |
| pnpm outdated | 12.11.2 | 1.42 s ± 0.11<br><sub>1.33–1.55</sub> | 0.16 s ± 0.00<br><sub>0.15–0.16</sub> | 41 |
| npm-check | — | not run: no workspace support |  |  |

Commands, run in the repository root:

```sh
inup --json --no-audit
ncu --jsonUpgraded --workspaces
taze major --recursive --include-locked --no-github-actions --no-node-version --json
syncpack update --check
pnpm outdated --recursive --format json
```

#### Opening the picker

| Tool | Version | First run | Repeat run |
| :-- | :-- | --: | --: |
| inup | 1.9.1 (5e30e59) | **0.61 s** ± 0.04<br><sub>0.57–0.67</sub> | 0.36 s ± 0.07<br><sub>0.31–0.52</sub> |
| taze | 21.3.0 | 1.61 s ± 0.68<br><sub>1.18–2.91</sub> | 0.46 s ± 0.01<br><sub>0.45–0.47</sub> |
| syncpack | 15.3.3 | 0.83 s ± 0.03<br><sub>0.78–0.88</sub> | 0.86 s ± 0.03<br><sub>0.81–0.91</sub> |
| pnpm update -i | 12.11.2 | 1.44 s ± 0.14<br><sub>1.29–1.65</sub> | **0.17 s** ± 0.02<br><sub>0.17–0.21</sub> |
| npm-check-updates | — | not run: asks about one package.json at a time |  |
| npm-check | — | not run: no workspace support |  |

Commands, run in the repository root in a 160×50 terminal:

```sh
inup --no-audit
taze major --interactive --recursive --include-locked --no-github-actions --no-node-version
syncpack update --interactive
pnpm update --interactive --latest --recursive
```

### TanStack/query

[`TanStack/query@ce77be5`](https://github.com/TanStack/query/tree/ce77be5e15c695df9d4d9122caf9256d334433ba) · pnpm@12.4.2 · 105 package.json files · 190 dependencies

Median, ± standard deviation, min–max, over 10 runs. Measured 14 Nov 2026 on GitHub Actions ubuntu24 20261111.370.1 · Linux 7.0.0-1017-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.22.2 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/43582621064).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.9.1 (5e30e59) | **1.25 s** ± 0.02<br><sub>1.22–1.27</sub> | 0.64 s ± 0.01<br><sub>0.63–0.66</sub> | 838 |
| npm-check-updates | 23.1.1 | 9.78 s ± 0.15<br><sub>9.64–10.08</sub> | 9.82 s ± 0.28<br><sub>9.40–10.34</sub> | 636 |
| taze | 21.3.0 | 10.2 s ± 0.60<br><sub>9.34–10.92</sub> | 6.65 s ± 0.04<br><sub>6.59–6.75</sub> | 831 |
| syncpack | 15.3.3 | 3.05 s ± 0.04<br><sub>3.00–3.12</sub> | **0.43 s** ± 0.00<br><sub>0.43–0.44</sub> | 134 |
| pnpm outdated | 12.4.2 | 3.18 s ± 0.17<br><sub>2.93–3.52</sub> | 4.35 s ± 0.10<br><sub>4.15–4.49</sub> | 114 |
| npm-check | — | not run: no workspace support |  |  |

Commands, run in the repository root:

```sh
inup --json --no-audit
ncu --jsonUpgraded --workspaces
taze major --recursive --include-locked --no-github-actions --no-node-version --json
syncpack update --check
pnpm outdated --recursive --format json
```

#### Opening the picker

| Tool | Version | First run | Repeat run |
| :-- | :-- | --: | --: |
| inup | 1.9.1 (5e30e59) | **1.40 s** ± 0.04<br><sub>1.37–1.49</sub> | 0.85 s ± 0.05<br><sub>0.79–0.93</sub> |
| taze | 21.3.0 | 10.7 s ± 1.47<br><sub>9.54–15.07</sub> | **0.45 s** ± 0.01<br><sub>0.43–0.46</sub> |
| syncpack | 15.3.3 | 2.96 s ± 0.04<br><sub>2.89–3.02</sub> | 2.96 s ± 0.11<br><sub>2.88–3.22</sub> |
| pnpm update -i | 12.4.2 | 3.15 s ± 0.22<br><sub>3.00–3.77</sub> | 4.13 s ± 0.10<br><sub>3.89–4.24</sub> |
| npm-check-updates | — | not run: asks about one package.json at a time |  |
| npm-check | — | not run: no workspace support |  |

Commands, run in the repository root in a 160×50 terminal:

```sh
inup --no-audit
taze major --interactive --recursive --include-locked --no-github-actions --no-node-version
syncpack update --interactive
pnpm update --interactive --latest --recursive
```

### vendurehq/vendure

[`vendurehq/vendure@1dcaf0e`](https://github.com/vendurehq/vendure/tree/1dcaf0ee504675f3462d6302c23ff9f16beb2773) · bun · 54 package.json files · 323 dependencies

Median, ± standard deviation, min–max, over 10 runs. Measured 14 Nov 2026 on GitHub Actions ubuntu24 20261111.127.1 · Linux 7.0.0-1014-aws · Intel(R) Xeon(R) 6975P-C · 4 CPUs · 15 GB · Node v24.22.2 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/43582621064).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.9.1 (5e30e59) | **0.86 s** ± 0.06<br><sub>0.82–0.97</sub> | 0.38 s ± 0.05<br><sub>0.37–0.49</sub> | 415 |
| npm-check-updates | 23.1.1 | 2.81 s ± 0.09<br><sub>2.75–3.04</sub> | 2.81 s ± 0.03<br><sub>2.76–2.87</sub> | 361 |
| taze | 21.3.0 | 4.94 s ± 0.36<br><sub>4.28–5.46</sub> | 1.58 s ± 0.07<br><sub>1.56–1.79</sub> | 406 |
| syncpack | 15.3.3 | 2.80 s ± 0.04<br><sub>2.72–2.85</sub> | 0.50 s ± 0.01<br><sub>0.49–0.51</sub> | 272 |
| bun outdated | 1.4.4 | 1.33 s ± 0.11<br><sub>1.32–1.60</sub> | **0.07 s** ± 0.00<br><sub>0.06–0.07</sub> | 339 |
| npm-check | — | not run: no workspace support |  |  |

Commands, run in the repository root:

```sh
inup --json --no-audit
ncu --jsonUpgraded --workspaces
taze major --recursive --include-locked --no-github-actions --no-node-version --json
syncpack update --check
bun outdated --recursive
```

#### Opening the picker

| Tool | Version | First run | Repeat run |
| :-- | :-- | --: | --: |
| inup | 1.9.1 (5e30e59) | **0.94 s** ± 0.02<br><sub>0.91–0.99</sub> | **0.51 s** ± 0.13<br><sub>0.47–0.89</sub> |
| taze | 21.3.0 | 4.08 s ± 0.29<br><sub>3.82–4.70</sub> | 1.57 s ± 0.02<br><sub>1.56–1.62</sub> |
| syncpack | 15.3.3 | 2.76 s ± 0.07<br><sub>2.64–2.88</sub> | 2.69 s ± 0.03<br><sub>2.67–2.77</sub> |
| bun update -i | 1.4.4 | 1.33 s ± 0.02<br><sub>1.31–1.37</sub> | 1.34 s ± 0.01<br><sub>1.32–1.36</sub> |
| npm-check-updates | — | not run: asks about one package.json at a time |  |
| npm-check | — | not run: no workspace support |  |

Commands, run in the repository root in a 160×50 terminal:

```sh
inup --no-audit
taze major --interactive --recursive --include-locked --no-github-actions --no-node-version
syncpack update --interactive
bun update --interactive --recursive
```

### backstage/backstage

[`backstage/backstage@76b0c7a`](https://github.com/backstage/backstage/tree/76b0c7a48ef737b1a46342c29269827715d70684) · yarn@4.18.0 · 269 package.json files · 591 dependencies

Median, ± standard deviation, min–max, over 10 runs. Measured 14 Nov 2026 on GitHub Actions ubuntu24 20261111.370.1 · Linux 7.0.0-1017-azure · Intel(R) Xeon(R) 6973P-C · 4 CPUs · 16 GB · Node v24.22.2 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/43582621064).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.9.1 (5e30e59) | **1.09 s** ± 0.03<br><sub>1.05–1.14</sub> | 0.77 s ± 0.08<br><sub>0.68–0.97</sub> | 1933 |
| npm-check-updates | 23.1.1 | 10.4 s ± 0.24<br><sub>9.75–10.51</sub> | 10.5 s ± 0.42<br><sub>9.84–11.45</sub> | 1852 |
| taze | 21.3.0 | 8.82 s ± 0.60<br><sub>8.19–10.26</sub> | 4.66 s ± 0.18<br><sub>4.43–5.07</sub> | 1866 |
| syncpack | 15.3.3 | 3.22 s ± 0.06<br><sub>3.15–3.33</sub> | **0.52 s** ± 0.02<br><sub>0.50–0.56</sub> | 489 |
| npm-check | — | not run: no workspace support |  |  |
| yarn upgrade-interactive | — | not run: Yarn 2+ lists updates only in this interactive picker |  |  |

Commands, run in the repository root:

```sh
inup --json --no-audit
ncu --jsonUpgraded --workspaces
taze major --recursive --include-locked --no-github-actions --no-node-version --json
syncpack update --check
```

#### Opening the picker

| Tool | Version | First run | Repeat run |
| :-- | :-- | --: | --: |
| inup | 1.9.1 (5e30e59) | **1.31 s** ± 0.08<br><sub>1.21–1.48</sub> | **1.00 s** ± 0.04<br><sub>0.96–1.08</sub> |
| taze | 21.3.0 | 8.62 s ± 0.29<br><sub>8.08–9.11</sub> | 4.73 s ± 0.12<br><sub>4.53–4.91</sub> |
| syncpack | 15.3.3 | 3.34 s ± 0.11<br><sub>3.15–3.49</sub> | 3.25 s ± 0.10<br><sub>3.05–3.40</sub> |
| yarn upgrade-interactive | 4.18.0 | 8.02 s ± 0.24<br><sub>7.64–8.30</sub> | 2.55 s ± 0.10<br><sub>2.45–2.76</sub> |
| npm-check-updates | — | not run: asks about one package.json at a time |  |
| npm-check | — | not run: no workspace support |  |

Commands, run in the repository root in a 160×50 terminal:

```sh
inup --no-audit
taze major --interactive --recursive --include-locked --no-github-actions --no-node-version
syncpack update --interactive
yarn upgrade-interactive
```
<!-- BENCHMARK:END -->
