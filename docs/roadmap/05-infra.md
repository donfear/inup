# ∞ — Infra: long-term health (runs in parallel with everything)

> **No dependency on the critical path** — hygiene you batch in whenever there's slack. The
> supply-chain trio (#2–#4) is ~half a day each and improves posture immediately; the coverage work
> is best timed as a *guardrail just ahead of the change it protects*.

See the [legend](README.md#legend) for rating definitions.

## Test coverage & safety nets

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 1 | **Raise core unit coverage toward ~50%+** | 🔴 | M | 2–4d | ~33 test files vs ~91 source files; no threshold configured. Prioritize the modules the feature phases touch: [upgrader.ts](../../src/features/upgrade/upgrader.ts) (writes), [package-detector.ts](../../src/features/upgrade/package-detector.ts), [version.ts](../../src/shared/versions.ts). **The write-path golden test is owned by [P0](01-correctness.md) #1** — this item is the broader fill-in around it. Do it *before* the P0 formatting change and the P2 keymap extraction ship. |
| 2 | **Coverage threshold gate** in vitest config | 🟡 | S | 0.25d | Add `coverage.thresholds` to [vitest.config.ts](../../vitest.config.ts) (no threshold today) to prevent regression once #1 lands. |
| 3 | **Snapshot/golden tests for the renderer** | 🟡 | M | 1–2d | Rendering is largely untested. Snapshot string output for representative states (themes, narrow width) **before** the [P2](03-trust-and-ux.md) width/keymap changes, so they lock behaviour rather than chase it. |

## Supply-chain posture (the parallelizable trio)

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 4 | **Dependabot / Renovate config** | 🔴 | S | 0.5d | Add `.github/dependabot.yml`. Strong dogfooding — inup *is* a dependency upgrader; it should keep itself current. |
| 5 | **`pnpm audit` (or osv-scanner) step in CI** | 🔴 | S | 0.5d | [.github/workflows/ci.yml](../../.github/workflows/ci.yml) runs format-check → test → build, with **no audit step**. Fail (or warn) on known vulnerabilities before release. |
| 6 | **Add ESLint** (typescript-eslint) + a `lint` script + CI step | 🔴 | M | 1–2d | Only Prettier today — **no eslint dep, no `lint`/`typecheck` script** ([package.json:9-25](../../package.json#L9-L25)), no eslint config on disk. The TS config is already strict, so ESLint mainly adds *complexity/import-hygiene* rules. Start with the recommended config to avoid churn. |
| 7 | **Add a `typecheck` script + pin a clean Node CI matrix** | 🟡 | S | 0.5d | `tsc --noEmit` for fast CI type-checking without emitting `dist/`. **And** CI currently runs **Node 24 only** ([ci.yml:24](../../.github/workflows/ci.yml#L24)) while `engines` requires ≥ 20 — test the supported range (20/22/24). |

## Code health (supports the feature phases)

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 8 | **Route scattered `console.*` through a leveled logger** | 🟡 | M | 1–2d | A [debug-logger.ts](../../src/shared/debug-logger.ts) exists but is underused; direct `console.*` is sprinkled across services. **Directly supports [P1](02-headless.md)** — clean leveling (debug/info/warn/error → stderr) is what makes `--json`/`--quiet` tractable. Pull forward if you start headless work. |
| 9 | **Tidy the renderer signatures** | 🟢 | S | 0.5d | `renderInterface` takes **15 positional args** ([renderer/index.ts:35-69](../../src/features/interactive/renderer/index.ts#L35-L69)) and `renderPackagesTable`/`renderConfirmation` take `any[]` ([:71](../../src/features/interactive/renderer/index.ts#L71),[:75](../../src/features/interactive/renderer/index.ts#L75)). Move to an options object + real types — do it *alongside* the [P2](03-trust-and-ux.md) width fix that touches the same file. |

## What was *not* scheduled (deliberate de-scoping)

- **"Decompose the 400-line modules."** Files like `package-detector.ts` and `input-handler.ts` are
  coherent at their current size. Splitting on line count, absent a concrete maintenance pain, is
  exactly the over-thinking this revision removes. The [P2](03-trust-and-ux.md) keymap extraction will
  shrink `input-handler.ts` naturally — let decomposition *fall out of* feature work, not precede it.
- **Standalone HTTP-timeout unification** folded into #8/normal maintenance rather than its own task —
  worth fixing the registry `Pool`'s missing per-request timeout when you're next in that file, not as
  scheduled work.

## Sequencing notes

- **#4–#5 are independent and parallelizable** — the natural first batch.
- **#1/#3 are guardrails** — install each just ahead of the change it protects (#1 before P0's write
  change; #3 before P2's renderer changes).
- **#8 supports P1** — pull it forward if headless work starts.
