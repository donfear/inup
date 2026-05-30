# P0 — Correctness: protect the writes that already work

> **Read this first, because it overturns the old plan.** The previous roadmap opened by claiming
> inup *"silently strips the `^`/`~` range prefix and pins your dependency on every upgrade."*
> **That is false against the current code** (verified 2026-05-30). The write at
> [upgrader.ts:142](../../src/core/upgrader.ts#L142)/[154](../../src/core/upgrader.ts#L154) does
> write `choice.targetVersion` verbatim — but that value is **already prefixed** upstream:
> [selection-state-builder.ts:127-139](../../src/ui/session/selection-state-builder.ts#L127-L139)
> builds it through `applyVersionPrefix()`
> ([ui/utils/version.ts:6-10](../../src/ui/utils/version.ts#L6-L10)), which lifts the original
> operator and re-applies it. So `"^1.2.3"` → `"^1.5.0"`. The headline bug doesn't exist.
>
> That changes this phase's job. It is no longer *"stop producing wrong results"* — it's **"protect
> the correct behavior with a test, then fix three genuinely-silent mis-detections."** P0 went from a
> phase to an afternoon. The trust floor is mostly already poured; we're sealing it.

See the [legend](README.md#legend) for rating definitions.

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 1 | **Lock the write path with a characterization test** | 🔴 | S | 0.5d | **New, and the most important item here.** Prefix-preservation works but has **no test guarding it** — one careless refactor of `applyVersionPrefix` or `createUpgradeChoices` silently reintroduces the exact bug the old roadmap feared. Golden-test the write end-to-end: feed a `package.json` with a `^` dep, a `~` dep, an exact pin, tabs *and* 4-space siblings; assert the output preserves each operator, the indentation, the trailing newline, and is a **no-op when nothing changed**. This is the cheapest insurance in the project and the guardrail for #2. Extend [test/unit/core](../../test/unit/core). |
| 2 | **Preserve `package.json` formatting on write** | 🔴 | S | 0.5–1d | [upgrader.ts:161](../../src/core/upgrader.ts#L161) does `JSON.stringify(pkg, null, 2) + '\n'`, normalizing tabs/4-space/odd-ordered files to 2-space and forcing a trailing newline. Real, but **S not M**: detect the existing indent (read the raw text before parse) and the original final-newline, round-trip both, and **skip the write entirely if the serialized result is unchanged**. Re-rated down — the old roadmap called this M by lumping it with the (non-existent) prefix bug. |
| 3 | **Detect Bun's text lockfile `bun.lock`** | 🔴 | S | 0.5d | Bun ≥ 1.2 writes a text `bun.lock`; the detector only lists `bun.lockb` ([package-manager-detector.ts:44](../../src/services/package-manager-detector.ts#L44),[:111](../../src/services/package-manager-detector.ts#L111)). A lockfile-only Bun repo falls through to the npm default. One array entry. *Narrow blast radius:* repos with `"packageManager": "bun@…"` are already caught by the field regex at [:92](../../src/services/package-manager-detector.ts#L92). |
| 4 | **Fix the `lib/` silent skip — make `SKIP_DIRS` overridable** | 🟡 | S | 0.5d | `SKIP_DIRS` hardcodes `lib`/`es`/`esm`/`cjs` ([scan.ts:9-19](../../src/utils/filesystem/scan.ts#L9-L19)), so a monorepo package living under `lib/` is **silently skipped, no warning**. The `.inuprc` reader already exists ([project-config.ts:8](../../src/config/project-config.ts#L8)) — add an `includeDirs`/`scanDirs` override there, and at minimum log when a `package.json`-bearing dir is pruned by the default list. *(Broader discovery work — `.gitignore` awareness, scanner de-dup — lives in [06-ecosystem.md](06-ecosystem.md).)* |

## Why this ordering

- **#1 before #2.** Write the lock test first, then make the formatting change against it — the test
  is what lets you touch [upgrader.ts:160-162](../../src/core/upgrader.ts#L160-L162) without fear,
  and it permanently documents the prefix-preservation contract so it can't quietly rot.
- **#3 and #4 are independent afternoon fixes.** Each kills one class of *silent* wrongness
  (mis-detected PM, skipped package). They don't depend on #1/#2 and can land in any order.

## What was removed from the old P0 (and why)

- **"Preserve the range-prefix style" (was the 🔴 headline).** ❌ **Already implemented.** Deleted,
  and its emotional framing with it. Its only legacy here is #1, which *locks* the behavior.
- **"Cross-platform `package.json` path handling."** Demoted to a footnote. The string
  `packageJsonPath.replace('/package.json', '')` at
  [upgrader.ts:122](../../src/core/upgrader.ts#L122) is POSIX-only, but it only feeds a **spinner
  label** (`packageDir`); the actual file write at [:161](../../src/core/upgrader.ts#L161) uses the
  real path, and install dir resolution at [:52](../../src/core/upgrader.ts#L52) already uses
  `dirname()`. It's a cosmetic log glitch on Windows, not a correctness bug. *Fix it opportunistically
  by copying the `dirname()` call from line 52 — don't schedule it.*

## Relationship to later phases

- The **`--save-exact`** opt-out (for users who *want* exact pins) lives in
  [06-ecosystem.md](06-ecosystem.md). Because preservation is already the default, that flag is now
  the *primary* prefix control rather than a follow-on — see its reframing there.
- **Routing detector warnings to stderr** (so they don't corrupt `--json`) is an output-hygiene
  concern handled in [02-headless.md](02-headless.md), not here.
- The **broader write-path coverage** (beyond the #1 golden test) is tracked in
  [05-infra.md](05-infra.md).
