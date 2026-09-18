import semver from 'semver'
import type { CooldownHold } from './types/domain'
import {
  type ParsedVersions,
  partitionVersionsByReleaseAge,
  type WithheldVersion,
} from './versions'

/**
 * Shared vocabulary for the release-age cooldown's *reporting* side.
 *
 * The gate itself lives in the detector; what lives here is how a hold is described once it
 * has happened. Three surfaces ask about holds — the picker header, the `--json` summary and
 * the plain report — and each previously counted them its own way. A cooldown is a security
 * control, so "how many packages are being held back" must mean exactly one thing everywhere.
 */

/** The minimal shape every surface needs from a scanned package. */
export interface CooldownHoldable {
  name: string
  isOutdated: boolean
  heldByCooldown?: CooldownHold
}

/** Same object, with the hold narrowed to non-optional. */
export type Held<T extends { heldByCooldown?: CooldownHold }> = T & { heldByCooldown: CooldownHold }

/**
 * The packages a hold applies to, narrowed so callers never re-check a value already
 * guaranteed present. Order is preserved: each entry names a distinct declaration site.
 */
export function packagesWithHolds<T extends { heldByCooldown?: CooldownHold }>(
  packages: readonly T[]
): Array<Held<T>> {
  return packages.filter((pkg): pkg is Held<T> => pkg.heldByCooldown !== undefined)
}

/**
 * How many packages have something held back, counted by unique NAME rather than by entry.
 *
 * The scan yields one entry per (package, file, dependency type), so a workspace repo
 * depending on the same package five times would otherwise report "5 held" for a single
 * withheld release. This is a risk count: one package is one thing to think about.
 *
 * `hiddenOnly` narrows to packages that are not outdated — the ones with no row of their own
 * in the picker, because every version newer than the installed one is inside the window.
 * Partially-held packages do get a row (and a `[HELD]` badge), so counting them in a header
 * that exists to surface the invisible ones would double-report them.
 */
export function countHeldPackages(
  packages: readonly CooldownHoldable[],
  { hiddenOnly = false }: { hiddenOnly?: boolean } = {}
): number {
  const names = new Set<string>()
  for (const pkg of packages) {
    if (pkg.heldByCooldown === undefined) continue
    if (hiddenOnly && pkg.isOutdated) continue
    names.add(pkg.name)
  }
  return names.size
}

/**
 * Describe a set of withheld versions as the single hold a user is shown.
 *
 * Reports the NEWEST withheld version: that is what would have been offered, and the thing
 * they need to know is being deliberately held back. Returns undefined for an empty set so
 * "nothing was held" stays representable without a sentinel.
 */
export function buildCooldownHold(
  withheld: readonly WithheldVersion[],
  now: number
): CooldownHold | undefined {
  const newest = withheld[0]
  if (!newest) return undefined
  return {
    version: newest.version,
    publishedAt: newest.publishedAt,
    // Clamped: a registry clock ahead of ours yields a future publish time, which is
    // withheld correctly but would otherwise report a negative age.
    ageMinutes: Math.max(0, Math.floor((now - Date.parse(newest.publishedAt)) / 60_000)),
    count: withheld.length,
  }
}

/** Inputs the cooldown needs about the dependency the packument is being resolved for. */
export interface CooldownContext {
  /** Minutes a version must have been public. `<= 0` disables the policy. */
  minimumReleaseAgeMinutes: number
  /** The installed version, or null when the specifier could not be parsed. */
  installed: semver.SemVer | null
  /** Raw specifier, used as the effective latest when nothing at all is old enough. */
  specifier: string
  /** Injected for determinism in tests. */
  now?: number
}

export interface CooldownDecision {
  /** The packument as the rest of the pipeline may see it: withheld versions removed. */
  data: ParsedVersions
  /** What to tell the user, or undefined when nothing reachable was withheld. */
  held?: CooldownHold
  /** Versions withheld across BOTH channels — the gate's own count, for diagnostics. */
  withheldTotal: number
}

/**
 * Enforce the release-age cooldown on one packument.
 *
 * Versions published more recently than the window are treated as if they don't exist yet,
 * so nothing downstream — picker, report or `--apply` — can select one. Freshly published
 * versions are the ones most likely to be a compromised release nobody has caught yet.
 *
 * Pure, and deliberately so: this is the whole of the policy, testable without a registry,
 * a detector or a clock.
 *
 * Both channels are GATED. Filtering only the stable pool would let a prerelease published
 * minutes ago through for anyone on the prerelease channel — the same attack, one channel
 * over. Only the channel this dependency can actually reach is REPORTED, because naming a
 * prerelease as "held back" from a stable install invents an upgrade that was never on offer.
 *
 * The effective latest is recomputed on the channel the original latest came from, so a
 * package with stable publishes never falls back onto a prerelease just because its recent
 * stable releases are inside the window. When that channel empties completely, the installed
 * version becomes the effective latest: "nothing to upgrade to (yet)".
 *
 * Health signals (deprecation, engines) describe the true latest, so they are dropped rather
 * than misattributed when the cooldown changes which version is latest.
 */
export function applyReleaseAgeCooldown(
  parsed: ParsedVersions,
  { minimumReleaseAgeMinutes, installed, specifier, now = Date.now() }: CooldownContext
): CooldownDecision {
  if (minimumReleaseAgeMinutes <= 0) return { data: parsed, withheldTotal: 0 }

  const { publishTimes } = parsed
  const stable = partitionVersionsByReleaseAge(
    parsed.allVersions,
    publishTimes,
    minimumReleaseAgeMinutes,
    now
  )
  // undefined (not an empty partition) exactly when the packument carried no prerelease pool,
  // so the absent-vs-present distinction survives into the returned data.
  const prerelease = parsed.prereleaseVersions
    ? partitionVersionsByReleaseAge(
        parsed.prereleaseVersions,
        publishTimes,
        minimumReleaseAgeMinutes,
        now
      )
    : undefined

  const withheldPrerelease = prerelease?.withheld ?? []
  const withheldTotal = stable.withheld.length + withheldPrerelease.length
  if (withheldTotal === 0) return { data: parsed, withheldTotal: 0 }

  const reportable = (
    (installed?.prerelease.length ?? 0) > 0
      ? [...stable.withheld, ...withheldPrerelease]
      : stable.withheld
  )
    .slice()
    .sort((a, b) => semver.rcompare(a.version, b.version))

  const installedFallback = installed?.version || specifier
  const effectiveLatest =
    semver.prerelease(parsed.latestVersion) !== null
      ? (prerelease?.eligible[0] ?? installedFallback)
      : (stable.eligible[0] ?? installedFallback)
  const latestUnchanged = effectiveLatest === parsed.latestVersion

  return {
    data: {
      ...parsed,
      latestVersion: effectiveLatest,
      allVersions: stable.eligible,
      prereleaseVersions: prerelease?.eligible,
      deprecated: latestUnchanged ? parsed.deprecated : undefined,
      enginesNode: latestUnchanged ? parsed.enginesNode : undefined,
    },
    held: buildCooldownHold(reportable, now),
    withheldTotal,
  }
}
