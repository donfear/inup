# P2 — Trust & UX: make the interactive product honest and discoverable

> **Status: shipped** (`feat/trust-and-ux`, merged 2026-05-30). All 9 tasks completed.

> The cheapest credibility phase. The symptom: **the shipped README documents keys that don't
> exist.** Its table ([README.md:57-68](../../README.md#L57-L68)) promises `Space` to toggle (there
> is **no `case 'space'`** in the handler) and labels `←/→` as *"patch/minor/major"* when they
> actually cycle a single selection **current → range → latest** ([input-handler.ts:252-258](../../src/features/interactive/input-handler.ts#L252-L258)).
> Meanwhile the real keys `d/p/o/s/!` are **absent** from that table. The instinct is to edit the
> README. The right fix is to remove the *possibility* of drift: make the keymap **data**, then let
> the input handler, the in-app help, and the docs all read from it.

See the [legend](README.md#legend) for rating definitions.

## The anchor: keymap-as-data (do this first — it dissolves four old tasks)

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 1 ✅ | **Extract the keymap into one declarative table** | 🔴 | M | 1–2d | `KEY_BINDINGS` in [keymap.ts](../../src/features/interactive/keymap.ts) is now the single source of truth. Drives dispatch, the `?` overlay, the footer hints, and the README table. |
| 2 ✅ | **`?` in-app help overlay** — rendered from the keymap table | 🔴 | S | 0.5d | [help-modal.ts](../../src/features/interactive/renderer/help-modal.ts) renders directly from `getHelpGroups()`. Scrollable, always correct. |
| 3 ✅ | **`Space` toggles selection** | 🔴 | S | 0.5d | `toggle_selection` action added; cycles to best available update (`latest` → `range`) or back to `none`. |
| 4 ✅ | **Generate the README keyboard section from the keymap** | 🔴 | S | 0.5d | `renderReadmeKeyTable()` writes between `<!-- KEYS:START -->`/`<!-- KEYS:END -->` markers. CI test (`keymap-readme.test.ts`) fails if README drifts. Run `pnpm docs:keys` to regenerate. |

## Discoverability & affordances

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 5 ✅ | **Use the real terminal width everywhere** | 🟡 | S | 0.5d | `renderPackageLine` hardcoded `80` removed; update-available banner in [cli.ts](../../src/cli.ts) now clamps to `process.stdout.columns` (40–100). |
| 6 ✅ | **Friendlier exit states** for "all up to date" / "nothing selected" | 🟡 | S | 0.5d | `notify_empty_selection` action shows an inline notice instead of silently swallowing Enter. Message strings updated for both terminal paths. |
| 7 ✅ | **"Only vulnerable" filter** (`v`) | 🟡 | S | 0.5d | `toggle_vulnerable_filter` action added; `s` starts the audit if no data exists, `v` toggles the filter once data is available. Both share one closure. |
| 8 ✅ | **Persist last filters / default target** | 🟡 | S | 0.5d | `ConfigManager.getFilters` / `setFilters` persist `PersistedFilters` (dep-type toggles + vulnerable-only) to the config file. Restored on next launch. |
| 9 ✅ | **Vim navigation aliases** (`j`/`k`, `g`/`G`) | 🟢 | S | 0.25d | All four are rows in the keymap table. `g`/`G` also adds jump-to-first / jump-to-last via `navigateTop` / `navigateBottom`. |

## Deferred / re-scoped (don't let these masquerade as quick wins)

- **Workspace-aware grouping** and **sort/group toggle** — 🟡 **M each, and net-new.** The old roadmap
  pitched these as "extends the existing `scope-grouping.ts`." **That module does not exist in
  `src/`** (only a stale `dist/` artifact; verified 2026-05-30). So these are *new* features with no
  seam to lean on, and they're most useful only *after* the Risk Score ([04](04-intelligence.md))
  gives "severity"/"size" real meaning. Schedule after P3, if at all.
- **Interactive per-version picker** — 🟡 M. Selection is `none → range → latest` today; all versions
  are already cached, so a picker modal is pure UI. Genuine nice-to-have, not a priority.
- **Mouse support** — 🟢 M. Last. Keyboard parity matters more.
