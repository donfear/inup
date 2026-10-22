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

- inup also checks every dependency for known vulnerabilities during the run, and its times include that check.
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

Median, ± standard deviation, min–max, over 10 runs. Measured 22 Oct 2026 on GitHub Actions ubuntu24 20261018.339.1 · Linux 7.0.0-1017-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.22.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/39738521077).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.8.7 (c67f702) | 0.41 s ± 25.71<br><sub>0.39–60.16</sub> | 0.36 s ± 24.66<br><sub>0.34–60.21</sub> | 22 |
| npm-check-updates | 23.1.1 | 0.66 s ± 0.05<br><sub>0.63–0.81</sub> | 0.65 s ± 0.03<br><sub>0.64–0.73</sub> | 22 |
| taze | 21.3.0 | 0.80 s ± 2.17<br><sub>0.49–5.19</sub> | 0.21 s ± 0.01<br><sub>0.20–0.23</sub> | 21 |
| syncpack | 15.3.3 | **0.22 s** ± 0.02<br><sub>0.20–0.26</sub> | **0.04 s** ± 0.01<br><sub>0.04–0.06</sub> | 22 |
| npm-check | 6.0.1 | 1.06 s ± 0.05<br><sub>1.02–1.16</sub> | 1.06 s ± 0.05<br><sub>1.03–1.18</sub> | — |
| npm outdated | 11.19.1 | 0.88 s ± 0.01<br><sub>0.87–0.89</sub> | 0.67 s ± 0.01<br><sub>0.66–0.68</sub> | 13 |

Commands, run in the repository root:

```sh
inup --json
ncu --jsonUpgraded
taze major --include-locked --no-github-actions --no-node-version --json
syncpack update --check
npm-check --skip-unused
npm outdated --json
```

#### Opening the picker

| Tool | Version | First run | Repeat run |
| :-- | :-- | --: | --: |
| inup | 1.8.7 (c67f702) | 0.47 s ± 0.04<br><sub>0.45–0.58</sub> | 0.44 s ± 0.04<br><sub>0.35–0.48</sub> |
| npm-check-updates | 23.1.1 | 0.65 s ± 0.04<br><sub>0.63–0.76</sub> | 0.65 s ± 0.03<br><sub>0.64–0.73</sub> |
| taze | 21.3.0 | 0.82 s ± 0.14<br><sub>0.67–1.22</sub> | 0.23 s ± 0.00<br><sub>0.22–0.23</sub> |
| syncpack | 15.3.3 | **0.23 s** ± 0.01<br><sub>0.22–0.25</sub> | **0.22 s** ± 0.05<br><sub>0.21–0.37</sub> |
| npm-check | 6.0.1 | 1.05 s ± 0.02<br><sub>1.04–1.08</sub> | 1.05 s ± 0.05<br><sub>1.03–1.15</sub> |
| npm update -i | — | not run: npm has no interactive update |  |

Commands, run in the repository root in a 160×50 terminal:

```sh
inup
ncu --interactive
taze major --interactive --include-locked --no-github-actions --no-node-version
syncpack update --interactive
npm-check --update --skip-unused
```

### vuejs/core

[`vuejs/core@65eae17`](https://github.com/vuejs/core/tree/65eae178383289b6a9f93505ab85017460f72395) · pnpm@12.11.2 · 22 package.json files · 69 dependencies

Median, ± standard deviation, min–max, over 10 runs. Measured 22 Oct 2026 on GitHub Actions ubuntu24 20261012.334.1 · Linux 6.17.0-1022-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.21.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/39738521077).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.8.7 (c67f702) | **0.95 s** ± 28.65<br><sub>0.80–60.23</sub> | 0.45 s ± 28.88<br><sub>0.40–60.23</sub> | 28 |
| npm-check-updates | 23.1.1 | 3.53 s ± 0.34<br><sub>3.15–4.30</sub> | 3.49 s ± 0.21<br><sub>3.08–3.61</sub> | 26 |
| taze | 21.3.0 | 1.60 s ± 0.57<br><sub>1.14–2.90</sub> | 0.50 s ± 0.01<br><sub>0.49–0.51</sub> | 27 |
| syncpack | 15.3.3 | 0.97 s ± 0.05<br><sub>0.88–1.08</sub> | **0.16 s** ± 0.00<br><sub>0.16–0.17</sub> | 24 |
| pnpm outdated | 12.11.2 | 1.97 s ± 0.24<br><sub>1.52–2.22</sub> | 0.18 s ± 0.01<br><sub>0.17–0.19</sub> | 28 |
| npm-check | — | not run: no workspace support |  |  |

Commands, run in the repository root:

```sh
inup --json
ncu --jsonUpgraded --workspaces
taze major --recursive --include-locked --no-github-actions --no-node-version --json
syncpack update --check
pnpm outdated --recursive --format json
```

#### Opening the picker

| Tool | Version | First run | Repeat run |
| :-- | :-- | --: | --: |
| inup | 1.8.7 (c67f702) | 1.03 s ± 0.03<br><sub>1.00–1.08</sub> | 0.52 s ± 0.04<br><sub>0.47–0.59</sub> |
| taze | 21.3.0 | 1.67 s ± 0.51<br><sub>1.09–2.73</sub> | 0.51 s ± 0.00<br><sub>0.50–0.52</sub> |
| syncpack | 15.3.3 | **0.97 s** ± 0.05<br><sub>0.90–1.03</sub> | 0.91 s ± 0.05<br><sub>0.83–0.98</sub> |
| pnpm update -i | 12.11.2 | 1.94 s ± 0.17<br><sub>1.54–2.07</sub> | **0.19 s** ± 0.01<br><sub>0.19–0.21</sub> |
| npm-check-updates | — | not run: asks about one package.json at a time |  |
| npm-check | — | not run: no workspace support |  |

Commands, run in the repository root in a 160×50 terminal:

```sh
inup
taze major --interactive --recursive --include-locked --no-github-actions --no-node-version
syncpack update --interactive
pnpm update --interactive --latest --recursive
```

### TanStack/query

[`TanStack/query@ce77be5`](https://github.com/TanStack/query/tree/ce77be5e15c695df9d4d9122caf9256d334433ba) · pnpm@12.4.2 · 105 package.json files · 190 dependencies

Median, ± standard deviation, min–max, over 10 runs. Measured 22 Oct 2026 on GitHub Actions ubuntu24 20261018.339.1 · Linux 7.0.0-1017-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.22.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/39738521077).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.8.7 (c67f702) | 31.0 s ± 31.06<br><sub>1.44–60.44</sub> | 60.4 s ± 25.18<br><sub>0.69–60.45</sub> | 608 |
| npm-check-updates | 23.1.1 | 9.65 s ± 0.41<br><sub>8.98–10.16</sub> | 9.91 s ± 2.27<br><sub>9.49–17.04</sub> | 588 |
| taze | 21.3.0 | 10.3 s ± 1.75<br><sub>8.51–13.42</sub> | 6.67 s ± 0.05<br><sub>6.61–6.79</sub> | 601 |
| syncpack | 15.3.3 | **2.70 s** ± 0.08<br><sub>2.66–2.86</sub> | **0.44 s** ± 0.01<br><sub>0.43–0.45</sub> | 118 |
| pnpm outdated | 12.4.2 | 2.99 s ± 0.06<br><sub>2.90–3.10</sub> | 4.50 s ± 0.15<br><sub>4.13–4.75</sub> | 99 |
| npm-check | — | not run: no workspace support |  |  |

Commands, run in the repository root:

```sh
inup --json
ncu --jsonUpgraded --workspaces
taze major --recursive --include-locked --no-github-actions --no-node-version --json
syncpack update --check
pnpm outdated --recursive --format json
```

#### Opening the picker

| Tool | Version | First run | Repeat run |
| :-- | :-- | --: | --: |
| inup | 1.8.7 (c67f702) | **1.61 s** ± 0.18<br><sub>1.53–2.15</sub> | 0.77 s ± 0.14<br><sub>0.73–1.17</sub> |
| taze | 21.3.0 | 9.39 s ± 2.95<br><sub>8.66–17.89</sub> | **0.45 s** ± 0.01<br><sub>0.45–0.48</sub> |
| syncpack | 15.3.3 | 2.57 s ± 0.06<br><sub>2.52–2.70</sub> | 2.61 s ± 0.08<br><sub>2.53–2.82</sub> |
| pnpm update -i | 12.4.2 | 2.87 s ± 0.06<br><sub>2.79–2.96</sub> | 4.32 s ± 0.14<br><sub>4.10–4.52</sub> |
| npm-check-updates | — | not run: asks about one package.json at a time |  |
| npm-check | — | not run: no workspace support |  |

Commands, run in the repository root in a 160×50 terminal:

```sh
inup
taze major --interactive --recursive --include-locked --no-github-actions --no-node-version
syncpack update --interactive
pnpm update --interactive --latest --recursive
```

### vendurehq/vendure

[`vendurehq/vendure@1dcaf0e`](https://github.com/vendurehq/vendure/tree/1dcaf0ee504675f3462d6302c23ff9f16beb2773) · bun · 54 package.json files · 323 dependencies

Median, ± standard deviation, min–max, over 10 runs. Measured 22 Oct 2026 on GitHub Actions ubuntu24 20261012.334.1 · Linux 6.17.0-1022-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.21.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/39738521077).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.8.7 (c67f702) | 60.4 s ± 30.15<br><sub>1.95–60.42</sub> | 60.4 s ± 17.37<br><sub>5.51–60.44</sub> | 362 |
| npm-check-updates | 23.1.1 | 2.81 s ± 0.12<br><sub>2.70–3.05</sub> | 2.85 s ± 0.11<br><sub>2.72–3.10</sub> | 352 |
| taze | 21.3.0 | 5.13 s ± 1.03<br><sub>4.68–8.07</sub> | 2.38 s ± 0.06<br><sub>2.31–2.51</sub> | 354 |
| syncpack | 15.3.3 | 3.88 s ± 0.05<br><sub>3.83–4.00</sub> | 0.67 s ± 0.01<br><sub>0.67–0.69</sub> | 264 |
| bun outdated | 1.4.3 | **1.55 s** ± 0.12<br><sub>1.49–1.91</sub> | **0.09 s** ± 0.00<br><sub>0.08–0.10</sub> | 327 |
| npm-check | — | not run: no workspace support |  |  |

Commands, run in the repository root:

```sh
inup --json
ncu --jsonUpgraded --workspaces
taze major --recursive --include-locked --no-github-actions --no-node-version --json
syncpack update --check
bun outdated --recursive
```

#### Opening the picker

| Tool | Version | First run | Repeat run |
| :-- | :-- | --: | --: |
| inup | 1.8.7 (c67f702) | 2.29 s ± 0.07<br><sub>2.23–2.45</sub> | **0.91 s** ± 0.08<br><sub>0.81–1.02</sub> |
| taze | 21.3.0 | 4.86 s ± 0.45<br><sub>4.55–5.86</sub> | 2.41 s ± 1.39<br><sub>2.32–6.78</sub> |
| syncpack | 15.3.3 | 3.68 s ± 0.03<br><sub>3.65–3.77</sub> | 3.68 s ± 0.07<br><sub>3.61–3.79</sub> |
| bun update -i | 1.4.3 | **1.60 s** ± 0.25<br><sub>1.51–2.08</sub> | 1.59 s ± 0.09<br><sub>1.49–1.83</sub> |
| npm-check-updates | — | not run: asks about one package.json at a time |  |
| npm-check | — | not run: no workspace support |  |

Commands, run in the repository root in a 160×50 terminal:

```sh
inup
taze major --interactive --recursive --include-locked --no-github-actions --no-node-version
syncpack update --interactive
bun update --interactive --recursive
```

### backstage/backstage

[`backstage/backstage@76b0c7a`](https://github.com/backstage/backstage/tree/76b0c7a48ef737b1a46342c29269827715d70684) · yarn@4.18.0 · 269 package.json files · 591 dependencies

Median, ± standard deviation, min–max, over 10 runs. Measured 22 Oct 2026 on GitHub Actions ubuntu24 20261012.334.1 · Linux 6.17.0-1022-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.21.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/39738521077).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.8.7 (c67f702) | 60.6 s ± 28.13<br><sub>2.33–60.67</sub> | 60.7 s ± 0.01<br><sub>60.64–60.67</sub> | 1925 |
| npm-check-updates | 23.1.1 | 13.0 s ± 0.31<br><sub>12.52–13.65</sub> | 12.7 s ± 0.36<br><sub>12.29–13.35</sub> | 1844 |
| taze | 21.3.0 | 11.1 s ± 1.09<br><sub>10.12–13.68</sub> | 6.65 s ± 0.11<br><sub>6.59–6.89</sub> | 1856 |
| syncpack | 15.3.3 | **3.90 s** ± 0.06<br><sub>3.80–3.98</sub> | **0.60 s** ± 0.00<br><sub>0.59–0.60</sub> | 481 |
| npm-check | — | not run: no workspace support |  |  |
| yarn upgrade-interactive | — | not run: Yarn 2+ lists updates only in this interactive picker |  |  |

Commands, run in the repository root:

```sh
inup --json
ncu --jsonUpgraded --workspaces
taze major --recursive --include-locked --no-github-actions --no-node-version --json
syncpack update --check
```

#### Opening the picker

| Tool | Version | First run | Repeat run |
| :-- | :-- | --: | --: |
| inup | 1.8.7 (c67f702) | **3.58 s** ± 0.16<br><sub>3.50–4.07</sub> | 1.52 s ± 0.10<br><sub>1.35–1.71</sub> |
| taze | 21.3.0 | 10.7 s ± 0.74<br><sub>10.48–12.67</sub> | **0.61 s** ± 0.01<br><sub>0.60–0.63</sub> |
| syncpack | 15.3.3 | 3.81 s ± 0.15<br><sub>3.72–4.23</sub> | 3.80 s ± 0.06<br><sub>3.73–3.93</sub> |
| yarn upgrade-interactive | 4.18.0 | 9.76 s ± 0.22<br><sub>9.24–9.94</sub> | 3.41 s ± 1.22<br><sub>3.28–7.25</sub> |
| npm-check-updates | — | not run: asks about one package.json at a time |  |
| npm-check | — | not run: no workspace support |  |

Commands, run in the repository root in a 160×50 terminal:

```sh
inup
taze major --interactive --recursive --include-locked --no-github-actions --no-node-version
syncpack update --interactive
yarn upgrade-interactive
```
<!-- BENCHMARK:END -->
