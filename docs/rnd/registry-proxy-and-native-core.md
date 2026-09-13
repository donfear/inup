# R&D: caching registry proxies (pnpr) and a native core

Status: measured 2026-09-13, no code change proposed. Numbers below are from a
190-package project on a ~110 Mbit/s link, `inup --json`, fresh `HOME` for
every "inup cold" run (empty ETag cache), medians where several runs were made.

## Where inup's time goes today

After the cold-run controller fix (#121):

| run | wall | what dominates |
| --- | --- | --- |
| cold (empty ETag cache) | ~5–7 s | downloading ~47 MB of packuments; pure download at 24 connections is 3.6 s |
| warm (all 304s) | ~1.0–1.3 s | ~190 revalidation round-trips to the CDN |
| startup (`--version`) | 0.08–0.11 s | Node boot + module load |

Nothing on the CPU side is on the critical path: stubbing `parseVersions`
entirely moved cold wall by 0 s (CPU −1 s). inup is a network-bound tool.

## pnpr mode: a caching registry in front of inup

[pnpr](https://pnpm.io/pnpr/) is the pnpm project's registry server in Rust:
it hosts packages, proxies and caches upstream registries, and can resolve a
pnpm project's dependency graph server-side. Experimental; source-available
under PolyForm Shield 1.0.0 (not open source). Installed with
`pnpm add -g @pnpm/pnpr` (native binary per platform).

### Is it npm-registry compatible?

Yes. It serves the standard routes inup uses: `GET /{name}`,
`GET /@scope/{name}` (abbreviated packument via `accept:
application/vnd.npm.install-v1+json`), dist-tags, tarballs. inup needed **no
code change**: it resolves the registry from the npm config chain, so
`registry=http://127.0.0.1:7677/` in `.npmrc` (or `npm_config_registry`)
routes every request through pnpr. The `--json` report was identical through
the proxy and direct (308 outdated packages in both).

The pnpm-specific resolver endpoint (`POST /-/pnpr/v0/resolve`, NDJSON
stream of a resolved lockfile) is not useful to inup: inup needs full version
lists for range/patch targets, which the standard packument route already
provides.

Minimal proxy config used for the measurement (`pnpr -c pnpr.yaml`, listens
on `127.0.0.1:7677`):

```yaml
storage: ./storage
cache: ./cache
registries:
  npmjs:
    type: upstream
    url: https://registry.npmjs.org/
    public: true
defaultRegistry: npmjs
```

### How fast

| path | inup cold | inup warm |
| --- | --- | --- |
| direct to registry.npmjs.org | 6.8 s | 1.0 s |
| through pnpr, proxy cache cold | 8.3 s | – |
| through pnpr, proxy cache warm | **1.8–2.0 s** (×3 runs) | 1.8 s |

- **Cold runs get ~3.5× faster** once the proxy has the packuments: every
  fetch is a LAN hit (p50 43–77 ms vs 384 ms direct). This is the only lever
  that beats the bandwidth floor, because it removes the WAN hop instead of
  optimising around it.
- **The first run through an empty proxy is slower** than direct (extra hop,
  pnpr pulls full packuments upstream itself).
- **Warm runs get slower** (1.8 s vs 1.0 s). pnpr's packument responses carry
  no `ETag`, so inup's conditional requests never get a 304 and every run
  re-downloads ~47 MB, from localhost. If pnpr adds ETags this goes away; it is
  their side, not ours.
- Freshness: pnpr serves packuments from its cache within a per-registry
  `maxage` window. Behind a proxy, inup's "never stale, always revalidated"
  guarantee becomes "as fresh as the proxy's TTL". Document, do not fight.

### Verdict

Nothing to build. Worth one sentence in the README: behind a caching registry
(pnpr, Verdaccio, Artifactory) cold runs are LAN-speed. The measurement kit is
this file plus `INUP_PERF=1` records.

## A Rust core with a TypeScript shell: would it work, would it matter?

It would work technically (napi-rs or a sidecar binary). It would not matter:

| candidate "core" | what Rust would change | measured impact on wall |
| --- | --- | --- |
| packument parse + semver sort | 1 s CPU → ~0.1 s | 0 s (parse is off the critical path; stubbing it entirely changed nothing) |
| HTTP fetch loop | none; both wait on the same bytes | 0 s |
| concurrency controller | same algorithm, same decisions | 0 s |
| whole binary (no Node boot) | 80 ms → ~5 ms startup | ~75 ms per run |

The only measurable win, startup, requires the *entire* CLI to be native,
i.e. the full rewrite (108 files, hand-rolled TUI, controller, caches), plus
per-platform binaries in the npm package. A partial core gets the parse win,
which is worth 0 s, and pays the packaging cost anyway. Compare pnpm 12: its
Rust engine won 30× on *cached, no-network* installs (boot + linking, all
local) and only 1.6× on clean installs, which are network-bound like every
inup run.

Where it would start to matter: a mode that does not touch the network
(offline report from cached data) or a 2000+ dependency monorepo where parse
CPU finally lands on the critical path. Both are product decisions first;
`worker_threads` would then get the same result without leaving TypeScript.

## "Is the app cooler with Rust?"

"Written in Rust" is a badge, not a benefit, for a tool whose time is spent
waiting on a registry. The honest pitch is the numbers: cold runs steady at
~5 s where they used to swing 5–24 s, ~1 s warm, 80 ms startup, and
LAN-speed behind any npm-compatible cache. A Rust claim would invite a
benchmark that shows ~0 difference. Spend the effort on the things that move
the table above.
