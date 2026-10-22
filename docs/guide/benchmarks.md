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
- inup is built from the commit being tested. The other tools are the latest versions on npm when the workflow runs, and the results list each version.
- Before any timing, each tool runs once and must exit successfully and find updates. The **Updates found** column shows what each tool reported, as a check that they all did the full job. Counts differ because tools group results differently: `pnpm outdated` lists each package once for the whole workspace, syncpack lists each version of a dependency once however many `package.json` files share it, and the others list a dependency once for each `package.json` that declares it. npm-check prints only a table, so it has no count.

## Where tools differ

- inup checks every dependency for known vulnerabilities by default. None of the other tools does, so inup runs here with `--no-audit`. The check is one request to npm's advisory service, which takes about 0.2 seconds to answer: on a small repository a normal run takes about that much longer, and on a large one the check runs while the registry lookups do.
- inup's first interactive run downloads its native core (about 1.5 MB) and checks it, so its first-run picker times include that download. Its listing runs never download it.
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

## Results

<!-- BENCHMARK:START -->
### expressjs/express

[`expressjs/express@0dee2c5`](https://github.com/expressjs/express/tree/0dee2c52c7c873498f8ed7d8ee4ddd0a04d3ada8) · npm · 1 package.json · 44 dependencies

Median, ± standard deviation, min–max, over 10 runs. Measured 22 Oct 2026 on GitHub Actions ubuntu24 20261012.334.1 · Linux 6.17.0-1022-azure · AMD EPYC 9V74 80-Core Processor · 4 CPUs · 16 GB · Node v24.21.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/39758864588).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.8.8 (c89046b) | 0.29 s ± 0.01<br><sub>0.28–0.29</sub> | 0.18 s ± 0.01<br><sub>0.18–0.22</sub> | 22 |
| npm-check-updates | 23.1.1 | 0.56 s ± 0.03<br><sub>0.54–0.63</sub> | 0.55 s ± 0.01<br><sub>0.55–0.58</sub> | 22 |
| taze | 21.3.0 | 0.39 s ± 0.37<br><sub>0.36–1.56</sub> | 0.16 s ± 0.00<br><sub>0.15–0.16</sub> | 21 |
| syncpack | 15.3.3 | **0.19 s** ± 0.02<br><sub>0.17–0.22</sub> | **0.04 s** ± 0.00<br><sub>0.04–0.04</sub> | 22 |
| npm-check | 6.0.1 | 0.90 s ± 0.03<br><sub>0.87–0.98</sub> | 0.90 s ± 0.03<br><sub>0.86–0.97</sub> | — |
| npm outdated | 11.19.0 | 0.73 s ± 0.03<br><sub>0.70–0.80</sub> | 0.53 s ± 0.02<br><sub>0.52–0.57</sub> | 13 |

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
| inup | 1.8.8 (c89046b) | 0.38 s ± 0.03<br><sub>0.36–0.46</sub> | 0.30 s ± 0.02<br><sub>0.28–0.34</sub> |
| npm-check-updates | 23.1.1 | 0.55 s ± 0.01<br><sub>0.53–0.57</sub> | 0.55 s ± 0.03<br><sub>0.54–0.63</sub> |
| taze | 21.3.0 | 0.76 s ± 1.55<br><sub>0.45–5.15</sub> | **0.17 s** ± 0.00<br><sub>0.17–0.18</sub> |
| syncpack | 15.3.3 | **0.21 s** ± 0.01<br><sub>0.19–0.23</sub> | 0.20 s ± 0.01<br><sub>0.19–0.23</sub> |
| npm-check | 6.0.1 | 0.88 s ± 0.02<br><sub>0.86–0.92</sub> | 0.92 s ± 0.03<br><sub>0.90–0.96</sub> |
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

Median, ± standard deviation, min–max, over 10 runs. Measured 22 Oct 2026 on GitHub Actions ubuntu24 20261018.339.1 · Linux 7.0.0-1017-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.22.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/39758864588).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.8.8 (c89046b) | **0.68 s** ± 0.03<br><sub>0.65–0.72</sub> | 0.30 s ± 0.05<br><sub>0.29–0.46</sub> | 28 |
| npm-check-updates | 23.1.1 | 3.02 s ± 0.16<br><sub>2.90–3.35</sub> | 3.00 s ± 0.16<br><sub>2.84–3.34</sub> | 26 |
| taze | 21.3.0 | 2.74 s ± 1.04<br><sub>1.14–4.50</sub> | 0.52 s ± 0.01<br><sub>0.49–0.53</sub> | 27 |
| syncpack | 15.3.3 | 0.93 s ± 0.03<br><sub>0.87–0.96</sub> | **0.17 s** ± 0.00<br><sub>0.17–0.17</sub> | 24 |
| pnpm outdated | 12.11.2 | 1.48 s ± 0.18<br><sub>1.38–1.90</sub> | 0.20 s ± 0.01<br><sub>0.19–0.23</sub> | 28 |
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
| inup | 1.8.8 (c89046b) | **0.82 s** ± 0.02<br><sub>0.78–0.85</sub> | 0.45 s ± 0.08<br><sub>0.43–0.64</sub> |
| taze | 21.3.0 | 1.57 s ± 0.59<br><sub>1.17–2.57</sub> | 0.53 s ± 0.01<br><sub>0.52–0.54</sub> |
| syncpack | 15.3.3 | 0.88 s ± 0.05<br><sub>0.83–0.98</sub> | 0.85 s ± 0.03<br><sub>0.80–0.90</sub> |
| pnpm update -i | 12.11.2 | 1.41 s ± 0.10<br><sub>1.37–1.70</sub> | **0.21 s** ± 0.01<br><sub>0.20–0.22</sub> |
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

Median, ± standard deviation, min–max, over 10 runs. Measured 22 Oct 2026 on GitHub Actions ubuntu24 20261018.339.1 · Linux 7.0.0-1017-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.22.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/39758864588).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.8.8 (c89046b) | **1.28 s** ± 0.05<br><sub>1.24–1.42</sub> | 0.47 s ± 0.20<br><sub>0.44–1.08</sub> | 608 |
| npm-check-updates | 23.1.1 | 9.57 s ± 0.22<br><sub>9.10–9.91</sub> | 9.92 s ± 0.44<br><sub>9.16–10.85</sub> | 588 |
| taze | 21.3.0 | 9.10 s ± 0.78<br><sub>8.34–10.58</sub> | 6.55 s ± 0.07<br><sub>6.49–6.70</sub> | 601 |
| syncpack | 15.3.3 | 2.73 s ± 0.11<br><sub>2.70–3.03</sub> | **0.44 s** ± 0.01<br><sub>0.43–0.45</sub> | 118 |
| pnpm outdated | 12.4.2 | 2.95 s ± 0.09<br><sub>2.72–3.04</sub> | 4.39 s ± 0.14<br><sub>4.23–4.72</sub> | 99 |
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
| inup | 1.8.8 (c89046b) | **1.56 s** ± 0.10<br><sub>1.46–1.81</sub> | 0.73 s ± 0.09<br><sub>0.64–0.93</sub> |
| taze | 21.3.0 | 10.2 s ± 1.06<br><sub>8.41–11.23</sub> | **0.45 s** ± 0.00<br><sub>0.44–0.46</sub> |
| syncpack | 15.3.3 | 2.58 s ± 0.09<br><sub>2.55–2.78</sub> | 2.57 s ± 0.07<br><sub>2.49–2.71</sub> |
| pnpm update -i | 12.4.2 | 2.86 s ± 0.06<br><sub>2.80–2.99</sub> | 4.25 s ± 0.12<br><sub>4.04–4.43</sub> |
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

Median, ± standard deviation, min–max, over 10 runs. Measured 22 Oct 2026 on GitHub Actions ubuntu24 20261012.334.1 · Linux 6.17.0-1022-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.21.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/39758864588).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.8.8 (c89046b) | 1.92 s ± 0.10<br><sub>1.83–2.21</sub> | 0.61 s ± 0.04<br><sub>0.58–0.73</sub> | 362 |
| npm-check-updates | 23.1.1 | 2.94 s ± 0.66<br><sub>2.83–4.52</sub> | 2.96 s ± 0.12<br><sub>2.80–3.11</sub> | 352 |
| taze | 21.3.0 | 5.15 s ± 0.86<br><sub>4.89–7.70</sub> | 2.44 s ± 0.12<br><sub>2.39–2.82</sub> | 355 |
| syncpack | 15.3.3 | 4.11 s ± 0.05<br><sub>4.00–4.19</sub> | 0.74 s ± 0.01<br><sub>0.72–0.76</sub> | 264 |
| bun outdated | 1.4.3 | **1.52 s** ± 0.22<br><sub>1.47–2.05</sub> | **0.09 s** ± 0.00<br><sub>0.09–0.10</sub> | 327 |
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
| inup | 1.8.8 (c89046b) | 2.44 s ± 0.05<br><sub>2.36–2.54</sub> | **0.86 s** ± 1.63<br><sub>0.81–6.01</sub> |
| taze | 21.3.0 | 4.66 s ± 0.21<br><sub>4.42–5.18</sub> | 2.49 s ± 0.07<br><sub>2.39–2.62</sub> |
| syncpack | 15.3.3 | 3.96 s ± 7.92<br><sub>3.90–29.01</sub> | 3.94 s ± 0.03<br><sub>3.92–4.00</sub> |
| bun update -i | 1.4.3 | **1.57 s** ± 0.12<br><sub>1.49–1.90</sub> | 1.58 s ± 1.27<br><sub>1.47–5.62</sub> |
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

Median, ± standard deviation, min–max, over 10 runs. Measured 22 Oct 2026 on GitHub Actions ubuntu24 20261018.339.1 · Linux 7.0.0-1017-azure · AMD EPYC 9V74 80-Core Processor · 4 CPUs · 16 GB · Node v24.22.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/39758864588).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.8.8 (c89046b) | **1.78 s** ± 0.03<br><sub>1.75–1.85</sub> | 0.85 s ± 0.10<br><sub>0.74–1.01</sub> | 1925 |
| npm-check-updates | 23.1.1 | 7.89 s ± 0.18<br><sub>7.64–8.20</sub> | 8.57 s ± 0.72<br><sub>7.98–10.27</sub> | 1844 |
| taze | 21.3.0 | 8.72 s ± 0.31<br><sub>8.21–9.13</sub> | 5.49 s ± 0.09<br><sub>5.39–5.72</sub> | 1858 |
| syncpack | 15.3.3 | 3.33 s ± 5.10<br><sub>3.24–19.52</sub> | **0.60 s** ± 0.02<br><sub>0.57–0.65</sub> | 481 |
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
| inup | 1.8.8 (c89046b) | **2.22 s** ± 0.09<br><sub>2.15–2.42</sub> | **1.24 s** ± 0.11<br><sub>1.05–1.36</sub> |
| taze | 21.3.0 | 8.79 s ± 0.16<br><sub>8.59–9.08</sub> | 5.61 s ± 1.64<br><sub>0.46–5.83</sub> |
| syncpack | 15.3.3 | 3.26 s ± 0.11<br><sub>3.12–3.44</sub> | 3.32 s ± 0.10<br><sub>3.22–3.56</sub> |
| yarn upgrade-interactive | 4.18.0 | 7.90 s ± 0.14<br><sub>7.74–8.13</sub> | 2.82 s ± 0.05<br><sub>2.72–2.89</sub> |
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
