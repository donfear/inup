# P2 — Trust & UX: make the interactive product honest and discoverable

> The cheapest credibility phase. The symptom: **the shipped README documents keys that don't
> exist.** Its table ([README.md:57-68](../../README.md#L57-L68)) promises `Space` to toggle (there
> is **no `case 'space'`** in the handler) and labels `←/→` as *"patch/minor/major"* when they
> actually cycle a single selection **current → range → latest** ([input-handler.ts:252-258](../../src/ui/input-handler.ts#L252-L258)).
> Meanwhile the real keys `d/p/o/s/!` are **absent** from that table. The instinct is to edit the
> README. The right fix is to remove the *possibility* of drift: make the keymap **data**, then let
> the input handler, the in-app help, and the docs all read from it.

See the [legend](README.md#legend) for rating definitions.

## The anchor: keymap-as-data (do this first — it dissolves four old tasks)

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 1 | **Extract the keymap into one declarative table** | 🔴 | M | 1–2d | Keys are hardcoded inline in the [input-handler.ts](../../src/ui/input-handler.ts) normal-mode switch ([:243-333](../../src/ui/input-handler.ts#L243-L333)): `m`/`l`/`u` bulk, `d`/`p`/`o` filters, `i`/`s`/`t`, plus `/` and `!`. Move them to a `{ key, action, label, context }[]` table that **(a)** drives the switch, **(b)** renders the `?` overlay (#2), and **(c)** generates the README key section (#4). One source of truth → drift becomes structurally impossible, and a new binding either slots into a free key or fails loudly instead of silently double-binding. |
| 2 | **`?` in-app help overlay** — rendered from the keymap table | 🔴 | S | 0.5d | Reuse the existing modal input pattern (theme/info/debug modals, [input-handler.ts:73-165](../../src/ui/input-handler.ts#L73-L165)). With #1 done, the overlay is just a render of the table — always correct, zero maintenance. |
| 3 | **`Space` toggles selection** | 🔴 | S | 0.5d | The README already promises this and it's a no-op today. Add it to the table; toggle between `none` and the last non-none option. The fastest single credibility fix. |
| 4 | **Generate the README keyboard section from the keymap** | 🔴 | S | 0.5d | Replace the hand-written (and wrong) table at [README.md:57-68](../../README.md#L57-L68) with generated output. Fixes the documented-but-missing (`Space`), the mislabeled (`←/→`), and the real-but-undocumented (`d/p/o/s/!`) in one move, permanently. *(This is the right home for the README keymap fix — not a one-off hand edit.)* |

> **These four were four separate concerns in the old plan** ("fix README table", "help overlay",
> "configurable keybindings", broken `Space`). They share one root cause. Solve the root, and
> configurable keybindings becomes a trivial table extension rather than a project.

## Discoverability & affordances

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 5 | **Use the real terminal width everywhere** | 🟡 | S | 0.5d | [renderer/index.ts:24](../../src/ui/renderer/index.ts#L24) hardcodes `80` for `renderPackageLine` even though `terminalWidth` is threaded through `renderInterface` right below it. **Also** the "update available" banner hardcodes `78` with manual column math ([cli.ts:105-126](../../src/cli.ts#L105-L126)). Both mis-render on wide/narrow terminals — fix together. |
| 6 | **Friendlier exit states** for "all up to date" / "nothing selected" | 🟡 | S | 0.5d | `return` silently does nothing when 0 packages are selected ([input-handler.ts:260-271](../../src/ui/input-handler.ts#L260-L271)) — show a hint instead. |
| 7 | **"Only vulnerable" filter** (e.g. `v`) | 🟡 | S | 0.5d | Audit data already exists ([vulnerability-checker.ts](../../src/services/vulnerability-checker.ts)); add a filter toggle in the #1 table alongside the `d`/`p`/`o` filters. **The cheap UI half of [04](04-intelligence.md) #1** (vuln-fix verdict) — build them together. |
| 8 | **Persist last filters / default target** | 🟡 | S | 0.5d | The `ConfigFile` interface persists only `theme` today ([config.ts:6-8](../../src/utils/config.ts#L6-L8)) — a clean `ConfigManager` singleton, easy to extend with `lastFilters`/`defaultTarget`. |
| 9 | **Vim navigation aliases** (`j`/`k`, `g`/`G`) | 🟢 | S | 0.25d | Trivial **once #1 exists** — just more rows in the table. Low-cost muscle-memory win. |

## Deferred / re-scoped (don't let these masquerade as quick wins)

- **Workspace-aware grouping** and **sort/group toggle** — 🟡 **M each, and net-new.** The old roadmap
  pitched these as "extends the existing `scope-grouping.ts`." **That module does not exist in
  `src/`** (only a stale `dist/` artifact; verified 2026-05-30). So these are *new* features with no
  seam to lean on, and they're most useful only *after* the Risk Score ([04](04-intelligence.md))
  gives "severity"/"size" real meaning. Schedule after P3, if at all.
- **Interactive per-version picker** — 🟡 M. Selection is `none → range → latest` today; all versions
  are already cached, so a picker modal is pure UI. Genuine nice-to-have, not a priority.
- **Mouse support** — 🟢 M. Last. Keyboard parity matters more.

## Sequencing

- **#1 → #2 → #3 → #4** is the core loop: extract the table, then the overlay, `Space`, and the
  generated README are nearly free and permanently correct.
- **#5, #6** are independent quick wins — anytime.
- **#7** rides along with [04](04-intelligence.md) #1.
