# P1 — Headless: become a program, not just a TUI

> **The spine, and the single biggest *real* gap** (verified 2026-05-30). `runCli`
> ([cli.ts:25](../../src/cli.ts#L25)) parses only `-d/--dir`, `-e/--exclude`, `-i/--ignore`,
> `--max-depth`, `--package-manager`, `--debug` ([cli.ts:137-145](../../src/cli.ts#L137-L145)) and
> then always renders the full-screen TUI via `upgrader.run()`
> ([cli.ts:99](../../src/cli.ts#L99)). There is **no `--json`, no `--check`, no `-y`, no
> `process.stdout.isTTY` branch, and no `$CI` detection.** Exit codes exist only for *crashes*
> ([cli.ts:69](../../src/cli.ts#L69),[:151](../../src/cli.ts#L151)), never for "updates exist." So
> inup can't be scripted, can't gate CI, and will **hang in a pipeline** waiting on a TUI nothing can
> drive. This phase is the foundation the intelligence layer ([04](04-intelligence.md)) sits on — a
> verdict is only useful if something other than a human eye can read it.

**Treat this as one epic, not nine tasks.** They share a single seam: a non-interactive path that
reuses the already-resolved outdated-package list *before* the TUI renders. Build that seam once
(#1); the rest are thin layers.

See the [legend](README.md#legend) for rating definitions.

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 1 | **Non-interactive core** — branch on `!process.stdout.isTTY`, `--yes`, or `$CI` | 🔴 | M | 2–3d | The keystone. Before `upgrader.run()` renders the TUI, detect non-interactive and route the resolved package list through a headless code path instead. Auto-detect `process.env.CI`. Everything below reuses this branch. |
| 2 | **`--json` + output hygiene** — machine-readable report on clean stdout | 🔴 | S | 1d | Serialize the same package data the list shows. **Bundled with the stderr fix it requires:** detector warnings currently `console.log` to **stdout** ([package-manager-detector.ts:69](../../src/shared/package-manager.ts#L69),[:130](../../src/shared/package-manager.ts#L130)), which would corrupt JSON — move them to stderr first. The enabler for CI checks and piping. |
| 3 | **`--check` mode + a meaningful exit code** | 🔴 | S | 0.5d | Exit **non-zero when updates (or vulnerabilities) exist**, like `prettier --check`. inup sets a failing code only on crashes today, so it can't gate a build. Pairs with `--json`. |
| 4 | **`-y/--yes` + target presets** (`--target patch\|minor\|latest`; aliases `--patch/--minor/--latest`) | 🔴 | M | 2–3d | **Merges four scattered old items.** Auto-select by tier and apply without the TUI, reusing the bulk-select logic behind `m`/`l` ([input-handler.ts:273-285](../../src/features/interactive/input-handler.ts#L273-L285)). One flag family, not new keys. |
| 5 | **`--dry-run`** — print the planned edits, skip write + install | 🔴 | M | 1–2d | Gate the write at [upgrader.ts:160](../../src/features/upgrade/upgrader.ts#L160) and install at [:41](../../src/features/upgrade/upgrader.ts#L41). Print a per-file version diff. Most valuable *after* [P0](01-correctness.md) so the preview reflects the preserved formatting/prefix. |
| 6 | **Plain non-TTY output + post-run summary** | 🔴 | S | 0.5d | When `!isTTY`, print a line-based report (not escape codes into a logfile), and close with a concise "upgraded N packages across M files" recap that surfaces the commit/revert command (git state is already known). Reuses the #1 branch. |
| 7 | **`NO_COLOR` / `FORCE_COLOR` + `--no-color`** | 🔴 | S | 0.5d | No handling today (grep-clean). Set chalk's level once at startup from env/flag before any render. Essential for clean CI logs. |
| 8 | **Safe apply: git revert + optional test hook** | 🟡 | M | 1–2d | inup already refuses to run on a dirty tree ([cli.ts:32-42](../../src/cli.ts#L32-L42)), so **git is the backup** — no file copying. On non-zero install exit ([upgrader.ts:83-90](../../src/features/upgrade/upgrader.ts#L83-L90)), offer `git checkout -- <changed package.json>`; optionally run a configured `--test "<cmd>"` first and revert on its failure. **Note:** [utils/git.ts](../../src/shared/git.ts) currently exports only `getGitWorkingTreeState` — this **adds** a checkout helper. This is the first rung of the north-star Verify Loop ([00](00-north-star.md)). |
| 9 | **`--include` allowlist** (inverse of `--ignore`) | 🟡 | S | 0.5d | **De-duplicated** (appeared twice in the old file). `--ignore` already exists ([cli.ts:139-142](../../src/cli.ts#L139-L142)) with glob→regex matching ([project-config.ts:103-132](../../src/shared/config/project-config.ts#L103-L132)); mirror it to target a subset by glob, in both modes. |

## The CI story, end to end

Once #1–#3, #6, #7 land, inup is a pipeline tool with no terminal required:

```
inup --check            # exit 1 if anything is outdated → fails the build
inup --json | jq …      # structured drift report for dashboards/bots
inup -y --target minor  # auto-apply the safe tier in a scheduled job
```

That is the transformation: from *"a thing I run manually"* into *"a thing my pipeline runs."*

## Sequencing within the phase

1. **#1 first** — the seam everything attaches to.
2. **#2** carries its own stderr fix — do it as one change so the JSON is parseable from day one.
3. **#3, #6, #7** are cheap and independent — batch them with #1.
4. **#5 (`--dry-run`) and #8 (safe apply) want [P0](01-correctness.md) done first**, so previews and
   reverts operate on correct, minimal-diff writes.
5. **#8's test-hook half** is the Verify Loop seed — keep it last and minimal.
