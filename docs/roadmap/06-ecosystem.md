# deeper — Ecosystem: widen who can use inup

> P0–P3 make inup *correct, scriptable, honest, and smart* for the mainstream case. This phase
> removes the walls that lock whole audiences out — private registries, prerelease channels, pnpm
> catalogs, non-standard layouts. None block the critical path, but **#1 is the difference between a
> personal tool and a team/enterprise one.**

See the [legend](README.md#legend) for rating definitions.

## Registry & resolution

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 1 | **Custom registry support** (`--registry <url>` + read `.npmrc`) | 🔴 | L | 3–4d | `NPM_REGISTRY_URL` is hardcoded at [constants.ts:2](../../src/shared/config/constants.ts#L2) and **nothing reads `.npmrc`** (grep-clean across `src/`), so Artifactory/Verdaccio/GH-Packages users **can't use inup at all.** Read `registry` + scoped-registry keys + auth tokens from `.npmrc`; forward through the HTTP layer ([npm-registry.ts](../../src/shared/registry/npm-registry.ts)). The single biggest *audience* unlock in the roadmap — scope it even if you don't build it soon. |
| 2 | **Opt-in prerelease versions** (`--pre`) | 🟡 | M | 1–2d | `parseVersions` filters with `/^\d+\.\d+\.\d+$/` ([version.ts:24-26](../../src/shared/versions.ts#L24-L26)), so `beta`/`rc`/`next` are **entirely invisible.** Add a flag/toggle to include them when explicitly requested. |
| 3 | **`--save-exact` flag** (pin without `^`) | 🟡 | S | 0.5d | **Now the _primary_ prefix control, not a follow-on.** Since range-prefix preservation is already the default (see [01](01-correctness.md)), the only missing knob is the *opt-out*: write bare versions on request for users who want exact pins. |
| 4 | **pnpm `catalog:` protocol support** | 🟡 | M | 1–2d | The detector skips `workspace:`/`file:`/`link:`/`github:`… ([package-detector.ts:427-433](../../src/features/upgrade/package-detector.ts#L427-L433)) **but not `catalog:`**, a growing pnpm pattern — so a `catalog:` spec currently falls through and is mishandled. At minimum skip it cleanly; ideally resolve via `pnpm-workspace.yaml`. |
| 5 | **GitHub token for changelogs** (`GITHUB_TOKEN`/`GH_TOKEN`) | 🟡 | S | 0.5d | The changelog GitHub client ([features/changelog/clients/](../../src/features/changelog/clients/)) is unauthenticated → GitHub's 60 req/hr limit is hit fast when browsing many packages. Send the token if present. |

## Caching & offline

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 6 | **Cache management** (`--no-cache`, `--clear-cache`, `--offline`) | 🟡 | S–M | 0.5–1d | A persistent disk cache exists ([persistent-cache.ts](../../src/shared/registry/persistent-cache.ts)) with `CACHE_TTL` ([constants.ts:5](../../src/shared/config/constants.ts#L5)), but there's no user-facing way to bypass, clear, or pin to it. `--offline` (never hit the network, surface staleness) is cheap on top of the same infrastructure. |

## Discovery (non-standard layouts)

> The silent-skip *bug* (`lib/`) is fixed in [01](01-correctness.md). These are the broader
> improvements for repos that rely on `.gitignore` or unusual structure.

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 7 | **De-dup the sync/async scanners, then respect `.gitignore`** | 🟡 | M | 1–2d | `findAllPackageJsonFiles` (sync) and `…Async` in [scan.ts](../../src/shared/fs/scan.ts) duplicate exclude/skip logic. **Collapse them first** (one code path), *then* add `.gitignore` parsing to that single path so discovery stops descending into ignored build trees. Order matters — de-dup de-risks the `.gitignore` work. |

## Sequencing notes

- **#1 is the strategic item** despite its size — it defines whether inup can be adopted inside a
  company, and its `.npmrc` reader overlaps the future Constraint Solver's need to understand
  resolution config ([00](00-north-star.md)).
- **#3 is trivial and rides on [01](01-correctness.md)** being done (it already is).
- **#7's two halves are ordered** — collapse the scanners before adding `.gitignore`.
