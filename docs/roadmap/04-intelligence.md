# P3 — Intelligence: turn data inup has into a verdict

> The first step toward the [north star](00-north-star.md): reasoning over data inup already has,
> turning a wall of versions into **"safe now / review / hold."** But the old roadmap's premise —
> *"it's all free, the data is already in memory"* — is **only partly true** (verified 2026-05-30).
> inup fetches the **abbreviated** npm packument
> (`accept: application/vnd.npm.install-v1+json`, [npm-registry.ts:88](../../src/services/npm-registry.ts#L88)),
> which **includes `deprecated` and `engines`** but **omits per-version `time`**. So this phase splits
> cleanly into *genuinely-free* signals and ones that need a fetch decision — and we build the free
> ones first.
>
> **Prerequisite:** the headless engine ([02](02-headless.md)). A verdict is only worth computing if a
> `--json` consumer or CI gate can act on it.

See the [legend](README.md#legend) for rating definitions.

## Tier A — zero new fetches (build these first)

Every input here reads a field inup *already* has in memory. The new code is *scoring*, not *fetching*.

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 1 | **Vuln-fix verdict — does the upgrade _clear_ the advisory?** | 🔴 | M | 2–3d | **The marquee feature.** [vulnerability-checker.ts](../../src/services/vulnerability-checker.ts) sends only the *current* version ([:62-65](../../src/services/vulnerability-checker.ts#L62-L65)) and captures each advisory's `vulnerable_versions` string ([:139](../../src/services/vulnerability-checker.ts#L139)) **but never compares it to the target.** Add `semver.satisfies(target, vulnerable_versions)` to mark **"✓ fixed by upgrade"** vs "still vulnerable." Turns the audit from information into guidance — and it's the highest-weight Risk Score input. *(Pairs with the only-vulnerable filter, [03](03-trust-and-ux.md) #7.)* |
| 2 | **Deprecation signal** | 🟡 | S | 0.5d | npm's `deprecated` field **is in the abbreviated response** but is dropped by the metadata mapper ([package-metadata.ts:4-40](../../src/features/changelog/parsers/package-metadata.ts#L4-L40)). Extract it; a deprecated target is a hard **"hold."** Cheap, high-signal. |
| 3 | **`engines.node` incompatibility warning** | 🟡 | S | 0.5–1d | `engines` is likewise present in the manifest and **read nowhere** (grep-clean). When a target raises `engines.node` above the local runtime, flag it: *"hold: needs Node ≥ 22, you're on 20."* |
| 4 | **Risk Score scaffold + semver-distance** | 🔴 | M | 2–3d | The composable score object that #1–#3 plug into, plus the cheapest own input: patch ≪ minor ≪ major (semver is already a dep; the diff is already computed for the UI). Render as a colour/badge **plus an explainable breakdown line — never a bare number.** The list then sorts/colours into "safe now / review / hold." |

## Tier B — needs a fetch decision or new parsing

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 5 | **Decide the fetch strategy: abbreviated vs full packument** | 🔴 | S | 0.5d | **New, and the gate for #6.** Today's abbreviated fetch is fast but has no `time`. Decide once: (a) keep abbreviated + a targeted `time`-only fetch for the few packages being scored, or (b) switch hot paths to the full document. This is the honest reason release-age isn't free — surface the trade-off, don't bury it. |
| 6 | **Release-age signal** | 🟡 | M | 1d | Never silently recommend a version published 6 hours ago. *Depends on #5* to obtain `time`. Then surface "published 2 days ago" and weight very-new versions as riskier. |
| 7 | **Changelog breaking-change signal** | 🟡 | M | 1–2d | Detect a `BREAKING`/`Migration` section in release notes ([release-notes-service.ts](../../src/features/changelog/services/release-notes-service.ts)). Presence ⇒ "review." Feeds the major/breaking highlight in [03](03-trust-and-ux.md). |
| 8 | **Adoption signal** | 🟢 | S | 0.5d | Download counts are already fetched ([npm-registry-client.ts](../../src/features/changelog/clients/npm-registry-client.ts)) and stored as `weeklyDownloads`; a target few have adopted yet is weak maturity evidence. Lowest-weight input — wire the existing data in. |
| 9 | **Persist vulnerability results** (short-TTL cache) | 🟡 | S | 0.5d | Advisories refetch every session; reuse [persistent-cache.ts](../../src/services/persistent-cache.ts) with a short TTL. Keeps the security signal off the critical path (a north-star non-negotiable: *fast*). |

## Later (L — graduate only after the score earns its place)

- **Changelog diff across the version range** — 🟡 L. The viewer shows the *latest* notes; surface
  *everything between current and target* for accumulated breaking changes. Feeds #7.
- **Full transitive (lockfile-tree) audit** — 🟡 L. Today's audit checks direct deps' current
  versions; a true `npm audit`-style walk reads the lockfile and flags transitive advisories. This is
  **north-star-adjacent** (lockfile-tree parsing is a "missing capability" in [00](00-north-star.md)) —
  don't start before Tier A ships.

## Why this is the right "first intelligence"

- **Tier A is genuinely free** — `deprecated`, `engines`, and the vuln cross-ref all read fields
  already in memory; only the scoring is new.
- **Explainable by construction.** Each signal is a separate contribution with its own reason string,
  so the UI can always answer *"why is this 'hold'?"* — the entire trust argument from [00](00-north-star.md).
- **It composes with everything before it.** The score colours the rows ([03](03-trust-and-ux.md)),
  can sort the list, and ships in `--json` ([02](02-headless.md)) so a CI gate can fail only on
  "hold"-tier upgrades.

## Sequencing

1. **#1 (vuln-fix) first** — marquee demo value and the heaviest-weighted input.
2. **#2, #3** next — nearly-free reads that immediately enrich the verdict.
3. **#4** composes them into the score object.
4. **#5 → #6** only when you're ready to pay for `time`.
5. **#7, #8, #9** fill out the score; the **L** items wait.
