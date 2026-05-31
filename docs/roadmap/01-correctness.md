# P0 — Correctness: protect the writes that already work

> **Status: shipped (2026-05-31).** All four items below are now implemented and tested. The phase
> opened smaller than the original roadmap feared — re-verifying against source showed the headline
> "prefix-stripping" bug never existed and two items were already done — so what shipped is: the
> formatting-preservation write fix (#2), the golden test that locks it (#1), and the `SKIP_DIRS`
> override + warning (#4). #3 was already present before this work.
>
> **On the (non-)bug.** The previous roadmap claimed inup *"silently strips the `^`/`~` range prefix
> and pins your dependency on every upgrade."* **That was false against the code.** The write at
> [upgrader.ts:142](../../src/core/upgrader.ts#L142)/[154](../../src/core/upgrader.ts#L154) writes
> `choice.targetVersion` verbatim — but that value is **already prefixed** upstream:
> [selection-state-builder.ts:120-133](../../src/ui/session/selection-state-builder.ts#L120-L133)
> builds it through `applyVersionPrefix()`
> ([ui/utils/version.ts:6-10](../../src/ui/utils/version.ts#L6-L10)), which lifts the original
> operator and re-applies it. So `"^1.2.3"` → `"^1.5.0"`. Default prefix preservation was — and is —
> already covered by a test
> ([selection-state-builder.test.ts:23-31](../../test/unit/ui/selection-state-builder.test.ts#L23-L31)).

See the [legend](README.md#legend) for rating definitions.

| # | Task | Value | Cx | Status |
|---|---|:--:|:--:|---|
| 1 | **Lock the write path with a characterization test** | 🔴 | S | ✅ **Done.** Default `^`/`~` preservation was already tested; this added the missing **end-to-end write** golden tests in [upgrader.test.ts](../../test/unit/core/upgrader.test.ts) — tab- and 4-space-indented fixtures, a `~`/exact operator, a no-trailing-newline file, and a **no-op when nothing changed** case (byte-identical output). Plus a focused unit test for the new format detector ([io.test.ts](../../test/unit/utils/io.test.ts)). |
| 2 | **Preserve `package.json` formatting on write** | 🔴 | S | ✅ **Done.** New `detectJsonFormat()` in [io.ts](../../src/utils/filesystem/io.ts) reads the raw text before parse to recover the original indent (tabs / N-space) and trailing-newline. [upgrader.ts](../../src/core/upgrader.ts) round-trips both and **skips the write entirely when the serialized result is unchanged**. |
| 3 | **Detect Bun's text lockfile `bun.lock`** | 🔴 | S | ✅ **Already done (pre-existing).** [package-manager-detector.ts:111-113](../../src/services/package-manager-detector.ts#L111-L113) lists `bun.lock` alongside `bun.lockb`, tested at [package-manager-detector.test.ts:95-101](../../test/unit/services/package-manager-detector.test.ts#L95-L101). No change needed. |
| 4 | **Fix the `lib/` silent skip — make `SKIP_DIRS` overridable** | 🟡 | S | ✅ **Done.** `.inuprc` now accepts a `scanDirs` override ([project-config.ts](../../src/config/project-config.ts)) that threads through `cli.ts` → `PackageDetector` → [scan.ts](../../src/utils/filesystem/scan.ts), mirroring `excludePatterns`. When a `package.json`-bearing `lib`/`es`/`esm`/`cjs` dir is pruned by the default list, the detector prints a one-time warning pointing at `scanDirs`. `node_modules`/`dist`/`build`/`coverage`/`out` are excluded from the warning to avoid noise. *(Broader discovery work — `.gitignore` awareness, scanner de-dup — lives in [06-ecosystem.md](06-ecosystem.md).)* |

## How it was sequenced

- **#1 alongside #2.** The golden write tests were written against the formatting change so
  [upgrader.ts](../../src/core/upgrader.ts) can be refactored without fear, and they permanently
  document the prefix- and format-preservation contract so it can't quietly rot.
- **#4 is independent.** It kills one class of *silent* wrongness (a real package skipped under
  `lib/`) and shares no code with #1/#2.

## What was removed from the old P0 (and why)

- **"Preserve the range-prefix style" (was the 🔴 headline).** ❌ **Already implemented.** Deleted,
  and its emotional framing with it. Its only legacy here is #1, which *locks* the behavior.
- **"Cross-platform `package.json` path handling."** Demoted to a footnote. The string
  `packageJsonPath.replace('/package.json', '')` at
  [upgrader.ts:122](../../src/core/upgrader.ts#L122) is POSIX-only, but it only feeds a **spinner
  label** (`packageDir`); the actual file write uses the real path, and install dir resolution at
  [:54](../../src/core/upgrader.ts#L54) already uses `dirname()`. It's a cosmetic log glitch on
  Windows, not a correctness bug. *Fix it opportunistically by copying the `dirname()` call — don't
  schedule it.*

## Relationship to later phases

- The **`--save-exact`** opt-out (for users who *want* exact pins) is **already implemented
  end-to-end** — flag at [cli.ts:151](../../src/cli.ts#L151), applied in
  [selection-state-builder.ts:120-133](../../src/ui/session/selection-state-builder.ts#L120-L133),
  tested at [selection-state-builder.test.ts:33-44](../../test/unit/ui/selection-state-builder.test.ts#L33-L44).
  Because preservation is the default, it is the primary prefix-control flag.
- **Routing detector warnings to stderr** (so they don't corrupt `--json`) is an output-hygiene
  concern handled in [02-headless.md](02-headless.md), not here. The new `scanDirs` skip warning
  uses `console.warn` and should be reviewed under that work.
- The **broader write-path coverage** (beyond the #1 golden tests) is tracked in
  [05-infra.md](05-infra.md).
