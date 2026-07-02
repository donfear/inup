# 00 — North Star: from upgrader to upgrade co-pilot

> The phase files (01–07) are *tasks* — they make inup **better**.
> This file is the *thesis* — what would make inup **inevitable**.

## The reframe

Nobody wants to "upgrade dependencies." They want to **stay current without breaking their app and
without spending an afternoon finding out the hard way.** The job inup is hired for isn't editing
version strings — it's *removing the fear*. Today inup, like `npm-check-updates`, `taze`, and
`npm outdated`, answers **"what's outdated?"** That question is commoditized. The unsolved, valuable
one is:

> **"Is this upgrade safe *for my code*, and if not, what exactly do I have to change?"**

A god-tier inup is the only tool that answers that — **locally, privately, before you commit.**
"Upgrade with confidence," not "upgrade and pray." That is the entire game.

## Why inup specifically can win this

inup already gathers, on most runs, much of the raw material the intelligence layer needs — it just
doesn't *reason* over it. **But be precise about what's actually in memory** (verified 2026-05-30),
because the previous version of this document over-claimed it:

| Asset | Where | Status today | Unlocks |
|---|---|---|---|
| Every published version per package | [npm-registry.ts](../../src/shared/registry/npm-registry.ts) | ✅ fetched | semver-distance scoring |
| `deprecated` field | abbreviated packument | ⚠️ fetched, **dropped** by [package-metadata.ts](../../src/features/changelog/parsers/package-metadata.ts) | hard-"hold" signal — just extract it |
| `engines` field | manifest | ⚠️ present, **read nowhere** | runtime-compat warning — just extract it |
| Vulnerability advisories incl. `vulnerable_versions` | [vulnerability-checker.ts](../../src/features/audit/vulnerability-checker.ts) | ⚠️ fetched, **never cross-referenced to the target** | "does this upgrade *fix* the CVE?" |
| Download counts | [npm-registry-client.ts](../../src/features/changelog/clients/npm-registry-client.ts) | ✅ fetched (`weeklyDownloads`) | adoption/maturity signal |
| Changelogs / GitHub releases | [features/changelog](../../src/features/changelog/) | ✅ fetched | breaking-change detection |
| Per-version publish **`time`** | npm registry | ❌ **NOT fetched** — inup requests the *abbreviated* doc ([npm-registry.ts:88](../../src/shared/registry/npm-registry.ts#L88)) | release-age scoring — **needs a fetch decision** ([04](04-intelligence.md) #5) |
| Full package.json graph | [package-detector.ts](../../src/features/upgrade/package-detector.ts) | ✅ | the constraint set to solve |
| Streaming + persistent cache | [persistent-cache.ts](../../src/shared/registry/persistent-cache.ts) | ✅ | doing the above *fast* |
| Git working-tree state | [utils/git.ts](../../src/shared/git.ts) | ✅ (read-only) | safe, revertible application |

The honest read: **most signals are a field-extraction away; `time` (release age) is the one that
isn't.** That distinction *is* the sequencing of [P3](04-intelligence.md).

## The wedges, tiered by honesty

They differ by an order of magnitude in cost and risk. **Build down the list; don't pretend the
bottom tier is plannable today.**

### NEAR — plannable now, mostly arithmetic ([04-intelligence.md](04-intelligence.md))

**The Risk Score — turn a wall of versions into a verdict.** A single, **explainable** 0–100 number
per upgrade, composed from: semver distance, the vuln-fix cross-reference, deprecation, `engines.node`,
changelog breaking-section presence, adoption, and (once the fetch decision is made) release age.
Output: the list sorts and colours into **"safe now / review / hold."** The cheapest wedge with the
highest perceived-intelligence payoff — and, crucially, its **first three inputs need no new fetch**
(see [04](04-intelligence.md) Tier A). This is the next real feature after the headless spine.

### FAR — large but independently shippable (each is its own project)

**The Verify Loop — "upgrade and pray" becomes "upgrade, verified."** Apply the selected set in an
**isolated git worktree**, run `install` → `build` → `test`, report pass/fail; on failure
**auto-bisect** the culprit and offer to keep only the green subset. *Seed:* the git-revert + test-hook
work in [02-headless.md](02-headless.md) #8 is the first rung.

**The Constraint Solver — never propose a set that won't install.** Treat a multi-select as a
constraint problem over **peer dependencies** and **ecosystem groups** (react + react-dom +
@types/react move together; all `@babel/*` align), and solve for a coherent version set. **Note:**
inup has *no* grouping primitive today (the previously-cited `scope-grouping.ts` is not in the
source) — so this builds the semantic-grouping layer from scratch; it doesn't extend an existing one.

### SPECULATIVE — research, not a backlog item

**Usage-Aware Impact — the holy grail.** Parse the user's own imports/call sites, intersect with each
package's **breaking surface** (changelog `BREAKING` entries + removed/renamed exports inferred from
shipped `.d.ts` between versions), and say:

> "You call `foo.bar()` in 3 files. It was **removed in v3**. Here are the call sites."

The difference between "react-router went 6→7 (risky)" and "you use two APIs from it and neither
changed — this major is safe *for you*." No competitor does this. It is also a genuine research
problem (JS/TS/ESM/CJS/JSX, re-exports, dynamic imports). **Treat it as a spike, not a sprint.** Start
absurdly narrow (static ESM named imports, TS-only) and prove signal before committing.

**The AI migration co-pilot.** Once Usage-Aware Impact yields *a breaking change + the exact affected
call sites*, an LLM can draft the migration diff for *this* repo. The god-tier leap — and it must
honor inup's ethos (**no telemetry, no data collection**) as a hard constraint:

- **Explicit opt-in**, off by default.
- **Bring-your-own-key**, provider-agnostic; nothing leaves the machine without consent.
- The deterministic engine is the product; AI is an *accelerator*, never a dependency. inup stays
  fully useful with network and AI both off.

> **Why this tier exists:** the most exciting ideas here are the least ready to plan. Keeping them
> visible but un-scheduled protects near-term work from being starved by ambition.

## Non-negotiables (the identity that must survive)

1. **Zero-config still works.** Intelligence is progressive: great with no setup, deeper if you opt
   in. Never a wizard on first run.
2. **Privacy-first, no telemetry.** A tool that edits source-controlled files earns trust by keeping
   computation local.
3. **Fast.** The streaming/cache architecture is a feature; the intelligence layer must stay off the
   critical path (compute async, render progressively).
4. **Beautiful & multi-PM.** TUI polish and npm/yarn/pnpm/bun parity are table stakes we don't regress.

## The roadmap arc

```
GOOD (today)            GREAT (P0→P3)                GOD TIER (the moat)
─────────────           ───────────────────          ─────────────────────────
interactive multi-PM    P0 protect correct writes    Verify Loop          (FAR)
upgrader, themes,       P1 headless engine           Constraint Solver    (FAR)
vuln badges,            P2 honest, discoverable UX    Usage-Aware Impact   (SPECULATIVE)
changelog viewer        P3 Risk Score (NEAR wedge)    + AI migration       (SPECULATIVE)

   "what's outdated?"      "what's safe?"               "fix it for me, safely"
```

Sequencing logic:

- **P0 is small now** — the feared write bug was already fixed; P0 just *locks* that with a test and
  cleans up three small mis-detections ([01](01-correctness.md)). Correctness is still the floor;
  it's just mostly already poured.
- **"Great" is mostly reasoning over data inup already fetches** — high leverage, low new
  infrastructure. But it needs the **headless engine** ([02](02-headless.md)) underneath it first, so
  a verdict has a consumer.
- **The NEAR wedge (Risk Score) is the only god-tier-adjacent feature worth scheduling now**, and its
  first inputs are free.
- **FAR and SPECULATIVE need net-new capability** — each lands one at a time, after the critical path
  is paid down.

## The repositioning, in one line

> **inup** — not "an interactive dependency upgrader," but **the dependency upgrade co-pilot: know
> what's safe, see what it touches, and fix it — locally, privately, before you ship.**

## Honest risks

- **Source parsing is hard** — why Usage-Aware Impact is *speculative*. Prove it on a spike first.
- **Verify Loop is slow & environment-dependent.** Opt-in, cache aggressively, bisect only on failure.
- **Risk scoring can mislead if it pretends to be precise.** Keep it *explainable* — always show the
  why, never a bare number.
- **AI cost/accuracy/privacy.** Strictly opt-in + BYO-key; suggestions are drafts the user reviews.
- **The newest risk: drift between the plan and the code.** This revision exists because the prior
  roadmap's headline rested on a bug that no longer existed. Every claim here is dated and verifiable —
  keep it that way.
