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

Median, ± standard deviation, min–max, over 10 runs. Measured 24 Oct 2026 on GitHub Actions ubuntu24 20261023.334.3 · Linux 6.17.0-1022-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.21.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/40096111481).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.9.0 (0267e8e) | 0.27 s ± 0.04<br><sub>0.26–0.39</sub> | 0.18 s ± 0.07<br><sub>0.18–0.33</sub> | 25 |
| npm-check-updates | 23.1.1 | 0.74 s ± 0.04<br><sub>0.67–0.78</sub> | 0.75 s ± 0.04<br><sub>0.68–0.80</sub> | 22 |
| taze | 21.3.0 | 0.70 s ± 0.16<br><sub>0.62–1.06</sub> | 0.21 s ± 0.01<br><sub>0.20–0.22</sub> | 24 |
| syncpack | 15.3.3 | **0.25 s** ± 0.01<br><sub>0.25–0.28</sub> | **0.04 s** ± 0.00<br><sub>0.04–0.05</sub> | 25 |
| npm-check | 6.0.1 | 1.14 s ± 0.04<br><sub>1.09–1.22</sub> | 1.15 s ± 0.04<br><sub>1.10–1.20</sub> | — |
| npm outdated | 11.19.0 | 0.91 s ± 0.03<br><sub>0.89–0.99</sub> | 0.69 s ± 0.02<br><sub>0.67–0.75</sub> | 13 |

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
| inup | 1.9.0 (0267e8e) | 0.40 s ± 0.02<br><sub>0.38–0.43</sub> | 0.33 s ± 0.05<br><sub>0.30–0.43</sub> |
| npm-check-updates | 23.1.1 | 0.70 s ± 0.04<br><sub>0.67–0.79</sub> | 0.75 s ± 0.03<br><sub>0.70–0.76</sub> |
| taze | 21.3.0 | 1.05 s ± 0.63<br><sub>0.75–2.49</sub> | **0.23 s** ± 0.00<br><sub>0.23–0.24</sub> |
| syncpack | 15.3.3 | **0.27 s** ± 0.02<br><sub>0.26–0.31</sub> | 0.28 s ± 0.02<br><sub>0.26–0.31</sub> |
| npm-check | 6.0.1 | 1.17 s ± 0.03<br><sub>1.13–1.22</sub> | 1.18 s ± 0.04<br><sub>1.11–1.24</sub> |
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

Median, ± standard deviation, min–max, over 10 runs. Measured 24 Oct 2026 on GitHub Actions ubuntu24 20261023.334.3 · Linux 6.17.0-1022-azure · AMD EPYC 9V74 80-Core Processor · 4 CPUs · 16 GB · Node v24.21.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/40096111481).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.9.0 (0267e8e) | **0.63 s** ± 1.54<br><sub>0.51–5.49</sub> | 0.22 s ± 0.01<br><sub>0.20–0.24</sub> | 30 |
| npm-check-updates | 23.1.1 | 2.55 s ± 0.12<br><sub>2.39–2.82</sub> | 2.63 s ± 0.16<br><sub>2.48–2.90</sub> | 30 |
| taze | 21.3.0 | 1.21 s ± 0.85<br><sub>0.90–3.14</sub> | 0.38 s ± 0.00<br><sub>0.37–0.39</sub> | 31 |
| syncpack | 15.3.3 | 0.83 s ± 0.04<br><sub>0.80–0.93</sub> | 0.15 s ± 0.00<br><sub>0.14–0.15</sub> | 28 |
| pnpm outdated | 12.11.2 | 1.39 s ± 0.11<br><sub>1.26–1.65</sub> | **0.14 s** ± 0.01<br><sub>0.13–0.15</sub> | 32 |
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
| inup | 1.9.0 (0267e8e) | **0.57 s** ± 0.04<br><sub>0.54–0.69</sub> | 0.35 s ± 0.05<br><sub>0.31–0.48</sub> |
| taze | 21.3.0 | 1.34 s ± 0.41<br><sub>1.06–2.38</sub> | 0.39 s ± 0.01<br><sub>0.38–0.40</sub> |
| syncpack | 15.3.3 | 0.81 s ± 0.04<br><sub>0.75–0.90</sub> | 0.77 s ± 0.25<br><sub>0.75–1.55</sub> |
| pnpm update -i | 12.11.2 | 1.37 s ± 0.12<br><sub>1.33–1.72</sub> | **0.15 s** ± 0.01<br><sub>0.14–0.16</sub> |
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

Median, ± standard deviation, min–max, over 10 runs. Measured 24 Oct 2026 on GitHub Actions ubuntu24 20261012.334.1 · Linux 6.17.0-1022-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.21.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/40096111481).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.9.0 (0267e8e) | **0.70 s** ± 0.10<br><sub>0.64–0.94</sub> | **0.37 s** ± 0.02<br><sub>0.36–0.43</sub> | 611 |
| npm-check-updates | 23.1.1 | 10.5 s ± 0.36<br><sub>10.06–11.41</sub> | 10.3 s ± 0.24<br><sub>9.71–10.56</sub> | 591 |
| taze | 21.3.0 | 9.30 s ± 0.68<br><sub>8.58–10.39</sub> | 6.78 s ± 0.09<br><sub>6.71–7.01</sub> | 604 |
| syncpack | 15.3.3 | 2.74 s ± 0.04<br><sub>2.68–2.82</sub> | 0.46 s ± 0.01<br><sub>0.45–0.48</sub> | 121 |
| pnpm outdated | 12.4.2 | 2.83 s ± 0.06<br><sub>2.72–2.93</sub> | 3.69 s ± 0.13<br><sub>3.47–3.88</sub> | 102 |
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
| inup | 1.9.0 (0267e8e) | **0.95 s** ± 0.08<br><sub>0.89–1.10</sub> | 0.64 s ± 0.08<br><sub>0.52–0.77</sub> |
| taze | 21.3.0 | 8.84 s ± 0.78<br><sub>8.60–11.26</sub> | **0.45 s** ± 0.00<br><sub>0.44–0.46</sub> |
| syncpack | 15.3.3 | 2.60 s ± 0.07<br><sub>2.55–2.78</sub> | 2.61 s ± 0.08<br><sub>2.55–2.77</sub> |
| pnpm update -i | 12.4.2 | 2.79 s ± 0.06<br><sub>2.74–2.93</sub> | 3.48 s ± 0.14<br><sub>3.31–3.72</sub> |
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

Median, ± standard deviation, min–max, over 10 runs. Measured 24 Oct 2026 on GitHub Actions ubuntu24 20261023.334.3 · Linux 6.17.0-1022-azure · AMD EPYC 9V74 80-Core Processor · 4 CPUs · 16 GB · Node v24.21.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/40096111481).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.9.0 (0267e8e) | **1.24 s** ± 0.08<br><sub>1.18–1.45</sub> | 0.54 s ± 0.07<br><sub>0.52–0.70</sub> | 404 |
| npm-check-updates | 23.1.1 | 3.75 s ± 0.08<br><sub>3.67–3.94</sub> | 3.72 s ± 0.07<br><sub>3.65–3.89</sub> | 352 |
| taze | 21.3.0 | 5.22 s ± 1.02<br><sub>4.40–7.38</sub> | 1.89 s ± 0.08<br><sub>1.84–2.06</sub> | 397 |
| syncpack | 15.3.3 | 3.48 s ± 0.13<br><sub>3.37–3.81</sub> | 0.64 s ± 0.02<br><sub>0.62–0.68</sub> | 264 |
| bun outdated | 1.4.4 | 1.47 s ± 0.13<br><sub>1.36–1.83</sub> | **0.08 s** ± 0.00<br><sub>0.07–0.08</sub> | 324 |
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
| inup | 1.9.0 (0267e8e) | **1.40 s** ± 0.11<br><sub>1.33–1.71</sub> | **0.68 s** ± 0.05<br><sub>0.62–0.78</sub> |
| taze | 21.3.0 | 4.53 s ± 0.40<br><sub>4.32–5.57</sub> | 1.88 s ± 0.63<br><sub>1.86–3.89</sub> |
| syncpack | 15.3.3 | 3.35 s ± 0.08<br><sub>3.20–3.46</sub> | 3.37 s ± 0.08<br><sub>3.26–3.49</sub> |
| bun update -i | 1.4.4 | 1.47 s ± 0.17<br><sub>1.43–1.91</sub> | 1.47 s ± 0.20<br><sub>1.42–1.94</sub> |
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

Median, ± standard deviation, min–max, over 10 runs. Measured 24 Oct 2026 on GitHub Actions ubuntu24 20261012.334.1 · Linux 6.17.0-1022-azure · AMD EPYC 9V74 80-Core Processor · 4 CPUs · 16 GB · Node v24.21.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/40096111481).

#### Listing outdated dependencies

| Tool | Version | First run | Repeat run | Updates found |
| :-- | :-- | --: | --: | --: |
| inup | 1.9.0 (0267e8e) | **1.39 s** ± 0.10<br><sub>1.33–1.58</sub> | 0.93 s ± 0.04<br><sub>0.88–1.00</sub> | 1925 |
| npm-check-updates | 23.1.1 | 11.4 s ± 0.21<br><sub>11.09–11.73</sub> | 11.4 s ± 0.43<br><sub>10.98–12.34</sub> | 1844 |
| taze | 21.3.0 | 8.87 s ± 0.33<br><sub>8.46–9.63</sub> | 5.00 s ± 0.21<br><sub>4.95–5.65</sub> | 1858 |
| syncpack | 15.3.3 | 3.21 s ± 0.06<br><sub>3.16–3.33</sub> | **0.51 s** ± 0.01<br><sub>0.51–0.54</sub> | 481 |
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
| inup | 1.9.0 (0267e8e) | **2.12 s** ± 0.06<br><sub>2.07–2.25</sub> | **1.17 s** ± 0.13<br><sub>1.03–1.48</sub> |
| taze | 21.3.0 | 8.76 s ± 0.44<br><sub>8.33–9.93</sub> | 5.27 s ± 0.26<br><sub>5.18–6.07</sub> |
| syncpack | 15.3.3 | 3.24 s ± 0.08<br><sub>3.13–3.38</sub> | 3.31 s ± 0.06<br><sub>3.29–3.47</sub> |
| yarn upgrade-interactive | 4.18.0 | 7.64 s ± 0.21<br><sub>7.22–7.93</sub> | 2.56 s ± 0.03<br><sub>2.50–2.62</sub> |
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
