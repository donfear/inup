# inup — Improvement Roadmap

A ranked, sequenced plan for `inup`. Every item is concrete, links to the source it touches, is rated
by **value** and **complexity**, and — new in this revision — was **verified against the working code
on 2026-05-30.** The files are **phases**; the phases build on each other.

`inup` is already a polished, *correct* interactive TUI upgrader (npm/yarn/pnpm/bun, monorepo-aware,
themes, vulnerability audit, changelog viewer). The earlier roadmap framed the work as *rescue*
("it silently mangles your files"). **That framing was wrong** — see [provenance](#what-this-revision-corrected-provenance).
The real work, in order, is: **lock the correct behavior that already exists**, **become usable
outside a terminal**, **stop lying about its own keymap**, and **turn the data it already has into a
verdict.**

## Read this first

**[00-north-star.md](00-north-star.md)** — the destination: how inup goes from *"an interactive
upgrader"* to **the dependency-upgrade co-pilot** that tells you whether an upgrade is safe *for your
code* before you run it. The phases are the path; the north star is where it leads.

## The critical path (read top to bottom)

The single most important idea: **do these in order.** Each phase unlocks the next.

| Phase | File | The job it finishes | Why it's here |
|:--:|---|---|---|
| **P0** | [01-correctness.md](01-correctness.md) | *Protect* the writes that already work | The feared "silent re-pin" bug **doesn't exist** — preservation already works. P0 now means: lock it with a test, then fix 3 small silent mis-detections. An afternoon, not a phase. |
| **P1** | [02-headless.md](02-headless.md) | Become a *program*, not just a TUI | `--json` / `--check` / `-y` / exit codes / non-TTY. **The single biggest real gap**, and the spine the intelligence layer stands on. |
| **P2** | [03-trust-and-ux.md](03-trust-and-ux.md) | Make the interactive product honest & discoverable | The README documents keys that don't exist. Fix the root cause (keymap-as-data), not the symptom. |
| **P3** | [04-intelligence.md](04-intelligence.md) | Turn data inup has into a *verdict* | The Risk Score. Its first three inputs need **zero new fetches**; the marquee is the vuln-fix verdict. |
| **∞** | [05-infra.md](05-infra.md) | Long-term health, runs in parallel | Coverage, ESLint, CI audit, Dependabot. Independent of the critical path — batch it whenever. |
| **deeper** | [06-ecosystem.md](06-ecosystem.md) | Widen *who* can use inup | Custom registry/`.npmrc`, prereleases, pnpm catalogs, `.gitignore`-aware discovery. |
| **reach** | [07-distribution.md](07-distribution.md) | Onboarding & release automation | CONTRIBUTING, architecture doc, tag-triggered publish. |

**52 sequenced items** across the seven phase files — down from ~70, after deleting one already-done
headline task, demoting cosmetic items to footnotes, merging duplicates, and dropping work the repo
already does (auto-generated release notes). Every remaining item was checked against the code.

## If you only do five things

This is the irreducible core.

1. **Lock the write path with a test.** Prefix + indent + newline preservation already works but is
   **unguarded** — one golden test stops it from silently regressing into the bug the old roadmap
   feared. → [01](01-correctness.md)
2. **Ship headless mode as one epic** — `--json`, `--check` + exit codes, `-y`, non-TTY fallback.
   One spine, not nine tasks. The biggest capability gap. → [02](02-headless.md)
3. **Make the keymap data, not code** — one table drives input handling, the `?` overlay, *and* a
   generated README section. Kills the doc-drift permanently. → [03](03-trust-and-ux.md)
4. **Ship the vuln-fix verdict** — cross-reference the upgrade target against each advisory's
   `vulnerable_versions` to say "✓ fixed by upgrade." The marquee intelligence win, and it needs no
   new data. → [04](04-intelligence.md)
5. **Detect `bun.lock`** and **stop silently skipping `lib/`** — two real silent mis-detections. → [01](01-correctness.md)

## True quick wins (🔴/🟡 value × S complexity, ~½ day each)

- **Detect `bun.lock`** (text lockfile) — one array entry. → [01](01-correctness.md)
- **`lib/` skip override** via `.inuprc` (+ warn on prune) — the reader already exists. → [01](01-correctness.md)
- **`Space` toggles selection** — make the README's existing promise real. → [03](03-trust-and-ux.md)
- **`?` help overlay** — reuse the modal pattern; surfaces the full keymap. → [03](03-trust-and-ux.md)
- **`NO_COLOR` / `--no-color`** — set chalk level once at startup. → [02](02-headless.md)
- **Deprecation signal** — read the `deprecated` field inup already fetches; a deprecated target is a
  hard "hold." → [04](04-intelligence.md)
- **`--save-exact`** — the now-primary prefix knob (preservation is already the default). → [06](06-ecosystem.md)
- **Dependabot config** + **`pnpm audit` in CI** — dogfood: this *is* a dependency upgrader. → [05](05-infra.md)
- **`CONTRIBUTING.md` + architecture doc** — document the already-good setup/test/release flow. → [07](07-distribution.md)

## Legend

**Value** — user/maintainer impact:

- 🔴 **High** — clear, broadly-felt win
- 🟡 **Medium** — solid improvement, narrower audience
- 🟢 **Nice-to-have** — polish or niche

**Complexity** — implementation cost:

- **S** — small, < 1 day, low risk, no architectural change
- **M** — medium, a few days
- **L** — large, architectural or cross-cutting

## What this revision corrected (provenance)

This roadmap was rebuilt after **verifying every load-bearing claim against the source** (2026-05-30).
The previous version was well-organized but rested on assertions that the code contradicts. The
corrections, because they reshaped the priorities:

- **The #1 headline task was already done.** "inup strips `^`/`~` and silently pins on every upgrade"
  is **false**: `applyVersionPrefix()` ([ui/utils/version.ts:6-10](../../src/features/interactive/renderer/version-format.ts#L6-L10))
  preserves the operator before the write. Deleted the task and its framing; replaced it with a
  regression test that *locks* the behavior.
- **A cited pillar doesn't exist.** `src/features/interactive/state/scope-grouping.ts` was referenced as a shipped
  feature and a Constraint-Solver seed; it's **absent from `src/`** (only a stale `dist/` artifact).
  Reframed the workspace-grouping items as net-new, and removed the false "extends existing grouping"
  claim from the north star.
- **"Intelligence is free" was half-wrong.** inup fetches the *abbreviated* packument, which **omits
  `time`** — so release-age is *not* free; it needs a fetch decision. (`deprecated` and `engines`
  *are* in that response, so those signals genuinely are cheap.)
- **One automation is already solved.** The publish workflow already sets `generate_release_notes:
  true`, so the "conventional-commits changelog generator" task was dropped as redundant.
- **One "bug" is cosmetic.** The Windows-unsafe `packageJsonPath.replace('/package.json','')` only
  feeds a spinner label, not a file write — demoted from a task to a footnote.
- **Re-rated by evidence.** Format-preserving write dropped M→S (it was inflated by being lumped with
  the non-existent prefix bug); the intelligence phase was reordered so the zero-new-fetch signals
  ship first.

The discipline going forward: **every claim is dated and verifiable.** This revision exists because a
polished plan drifted from the code it described — the cheapest insurance against that is to cite the
line and check it.
