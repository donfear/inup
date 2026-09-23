import * as semver from 'semver'
import { extractEnginesNode, normalizeDeprecatedMessage } from './manifest'

export function toComparableVersion(version: string): string | null {
  const validVersion = semver.valid(version)
  if (validVersion) return validVersion
  const coerced = semver.coerce(version)
  return coerced ? coerced.version : null
}

export interface ParsedVersions {
  latestVersion: string
  allVersions: string[]
  // Prerelease versions (any tag: alpha/beta/rc/preview/…), sorted descending.
  // Optional so callers tolerate data from sources that never carried it
  // (hand-built fixtures, failed-fetch fallbacks).
  prereleaseVersions?: string[]
  deprecated?: string // npm deprecation message for the latest version, if any
  enginesNode?: string // declared engines.node range for the latest version, if any
  /**
   * ISO publish timestamp per version, from the packument's `time` field. Only present when the
   * FULL packument was fetched (the abbreviated install-v1 format has no `time`), i.e. when a
   * release-age policy is active. Restricted to the versions in `allVersions` and
   * `prereleaseVersions`.
   */
  publishTimes?: Record<string, string>
}

export function parseVersions(raw: string): ParsedVersions {
  const data = JSON.parse(raw) as {
    versions?: Record<string, unknown>
    time?: Record<string, string>
  }
  const versions = data.versions || {}
  const versionKeys = Object.keys(versions)
  // Stable versions only — prereleases are kept in their own list so they are
  // never offered to users on a stable version. The strict x.y.z shape also
  // keeps build-metadata variants (1.0.0+build) out of the stable pool.
  const allVersions = versionKeys.filter((v) => /^[0-9]+\.[0-9]+\.[0-9]+$/.test(v))
  const sortedVersions = allVersions.sort(semver.rcompare)
  const prereleaseVersions = versionKeys
    .filter((v) => semver.valid(v) !== null && semver.prerelease(v) !== null)
    .sort(semver.rcompare)
  // A package that has only ever published prereleases still has a meaningful
  // latest; without this fallback it would be reported as unavailable.
  const latestVersion =
    sortedVersions.length > 0
      ? sortedVersions[0]
      : prereleaseVersions.length > 0
        ? prereleaseVersions[0]
        : 'unknown'

  // Publish times exist only in the full packument; keep just the entries for versions we track
  // (`time` also carries 'created'/'modified' and prerelease keys).
  //
  // Stays UNDEFINED when no tracked version got a usable timestamp, even if `time` itself was
  // present. An empty map is not "publish times we happen to have none of" — it is no publish
  // times at all, and the release-age cooldown keys both its fail-open shortcut and its
  // "could this control act?" diagnostic off this field being absent.
  let publishTimes: Record<string, string> | undefined
  if (data.time) {
    const collected: Record<string, string> = {}
    for (const version of [...allVersions, ...prereleaseVersions]) {
      const publishedAt = data.time[version]
      if (typeof publishedAt === 'string') {
        collected[version] = publishedAt
      }
    }
    if (Object.keys(collected).length > 0) publishTimes = collected
  }

  // Surface health signals for the latest version straight from the abbreviated
  // packument we already fetched — no extra request. Both fields are optional.
  const latestManifest = versions[latestVersion] as
    | { deprecated?: unknown; engines?: unknown }
    | undefined
  const deprecated = normalizeDeprecatedMessage(latestManifest?.deprecated)
  const enginesNode = extractEnginesNode(latestManifest?.engines)

  return { latestVersion, allVersions, prereleaseVersions, deprecated, enginesNode, publishTimes }
}

/**
 * Extract the concrete installed version from a package.json specifier without
 * losing a prerelease tag: semver.coerce('^1.0.0-beta.2') drops the '-beta.2',
 * so ranges go through minVersion first. coerce stays as the last resort for
 * malformed input. Note: for open ranges like '>2.0.0' minVersion yields 2.0.1
 * (the lowest version actually allowed) where coerce yielded 2.0.0.
 */
export function parseCurrentVersion(specifier: string): semver.SemVer | null {
  const trimmed = specifier.trim()
  // Pure wildcards ('x', 'x.x', '*', '') pin nothing — minVersion would
  // resolve them to 0.0.0 and flag every such dep as outdated (and a later
  // applyVersionPrefix would write garbage like 'x2.5.1'). coerce returned
  // null for these; keep that contract.
  if (/^[xX*\s.]*$/.test(trimmed)) return null
  const exact = semver.valid(trimmed)
  if (exact) return semver.parse(exact)
  try {
    const min = semver.minVersion(specifier)
    if (min) return min
  } catch {
    // Not a parseable range — fall through to coerce.
  }
  return semver.coerce(specifier)
}

/**
 * Build the pool of upgrade candidates for one dependency.
 * Stable current version: the stable list, untouched — prereleases stay invisible.
 * Prerelease current version: stable list plus prereleases sharing the current
 * major.minor.patch tuple, matching npm range semantics ('^1.0.0-beta.2'
 * satisfies '1.0.0-rc.3' but never '1.1.0-alpha.1'). Result stays descending.
 */
export function buildRangeCandidates(
  current: semver.SemVer | null,
  allVersions: string[],
  prereleaseVersions?: string[]
): string[] {
  if (!current || current.prerelease.length === 0 || !prereleaseVersions?.length) {
    return allVersions
  }
  const sameTuple = prereleaseVersions.filter((v) => {
    const parsed = semver.parse(v)
    return (
      parsed !== null &&
      parsed.major === current.major &&
      parsed.minor === current.minor &&
      parsed.patch === current.patch
    )
  })
  if (sameTuple.length === 0) {
    return allVersions
  }
  return [...allVersions, ...sameTuple].sort(semver.rcompare)
}

/**
 * Highest version across the stable and prerelease lists (both descending, so
 * only the heads are compared). Used as the effective latest when the current
 * version is a prerelease: the user opted into the prerelease channel.
 */
export function highestOverallVersion(
  allVersions: string[],
  prereleaseVersions?: string[]
): string | null {
  const stable = allVersions[0] ?? null
  const pre = prereleaseVersions?.[0] ?? null
  if (stable === null) return pre
  if (pre === null) return stable
  return semver.gt(pre, stable) ? pre : stable
}

/** A version the cooldown withheld, carrying the timestamp that caused it to be withheld. */
export interface WithheldVersion {
  version: string
  publishedAt: string
}

export interface ReleaseAgePartition {
  eligible: string[]
  withheld: WithheldVersion[]
}

/**
 * Split versions into those old enough to offer and those still inside the cooldown window
 * (`minimumReleaseAge`, minutes).
 *
 * This is a supply-chain guard: freshly published versions are the ones most likely to be a
 * compromised release nobody has caught yet. Versions without a parsable publish timestamp
 * stay ELIGIBLE — the policy only acts on positive evidence, so a registry that doesn't
 * expose `time` degrades to a no-op rather than hiding every version.
 *
 * Withheld entries carry their timestamp rather than requiring a second lookup, so callers
 * reporting what was held cannot end up re-checking a value already known to exist.
 */
export function partitionVersionsByReleaseAge(
  versions: string[],
  publishTimes: Record<string, string> | undefined,
  minimumReleaseAgeMinutes: number,
  now: number = Date.now()
): ReleaseAgePartition {
  if (!publishTimes) return { eligible: versions, withheld: [] }

  const cutoff = now - minimumReleaseAgeMinutes * 60_000
  const eligible: string[] = []
  const withheld: WithheldVersion[] = []
  for (const version of versions) {
    const publishedAt = publishTimes[version]
    const timestamp = publishedAt === undefined ? Number.NaN : Date.parse(publishedAt)
    if (publishedAt === undefined || Number.isNaN(timestamp) || timestamp <= cutoff) {
      eligible.push(version)
    } else {
      withheld.push({ version, publishedAt })
    }
  }
  return { eligible, withheld }
}

/**
 * The first version a caret range treats as breaking for `version`: its next major — or, below
 * 1.0.0, where the leftmost non-zero part carries breaking changes, the next 0.y minor (the next
 * patch for 0.0.z). The `-0` makes it an exclusive bound that also shuts out that line's own
 * prereleases, like npm's own `<2.0.0-0`.
 */
function nextBreakingVersion({ major, minor, patch }: semver.SemVer): string {
  if (major > 0) return `${major + 1}.0.0-0`
  if (minor > 0) return `0.${minor + 1}.0-0`
  return `0.0.${patch + 1}-0`
}

/**
 * Whether `version` breaks compatibility with the installed version under semver's caret rules:
 * a new major, a new 0.y minor, or a new 0.0.z patch. This is what `.inuprc` `ignoreMajor`
 * suppresses.
 */
export function isBreakingUpdate(installed: semver.SemVer, version: string): boolean {
  return semver.gte(version, nextBreakingVersion(installed))
}

/**
 * Exclusive upper bound of the range target, following the specifier's operator. Only simple
 * specifiers (isSimpleVersionSpecifier) are ever resolved, so the first character is the operator:
 * - `^1.2.3` → 2.0.0-0 (same major), `^0.2.3` → 0.3.0-0 (same 0.y), `^0.0.3` → 0.0.4-0 (itself)
 * - `~1.2.3` → 1.3.0-0 (same major.minor)
 * - exact pins, `=` and `>=` → the next major: the "minor" target for pinned projects
 */
function rangeTargetCeiling(specifier: string, installed: semver.SemVer): string {
  if (specifier.startsWith('^')) return nextBreakingVersion(installed)
  if (specifier.startsWith('~')) return `${installed.major}.${installed.minor + 1}.0-0`
  return `${installed.major + 1}.0.0-0`
}

/**
 * Newest candidate above the installed version and below `ceiling` (exclusive). Compared by
 * semver precedence, so the input order does not matter and prereleases rank natively
 * (1.0.0-beta.2 < 1.0.0-rc.3 < 1.0.0).
 */
function newestBelow(
  installed: semver.SemVer,
  candidates: string[],
  ceiling: string
): string | null {
  const installedIsStable = installed.prerelease.length === 0
  const upperBound = new semver.SemVer(ceiling)
  let best: semver.SemVer | null = null
  let bestVersion: string | null = null
  for (const version of candidates) {
    const parsed = semver.parse(version)
    if (!parsed) continue // Skip invalid versions
    // A stable install is never offered a prerelease, even if one leaks into the list.
    if (installedIsStable && parsed.prerelease.length > 0) continue
    if (
      semver.gt(parsed, installed) &&
      semver.lt(parsed, upperBound) &&
      (best === null || semver.gt(parsed, best))
    ) {
      best = parsed
      bestVersion = version
    }
  }
  return bestVersion
}

/**
 * The range target: what the "range" column offers, what `--apply --target minor` writes and
 * what the GitHub Action applies unattended. The newest candidate the specifier's operator
 * allows (see `rangeTargetCeiling`), or null when nothing newer is in reach. Prerelease installs
 * get npm range semantics from their candidate pool (`buildRangeCandidates`).
 */
export function findRangeTargetVersion(specifier: string, candidates: string[]): string | null {
  const installed = parseCurrentVersion(specifier)
  if (!installed) {
    return null
  }
  return newestBelow(installed, candidates, rangeTargetCeiling(specifier, installed))
}

/**
 * Find the highest patch version in the installed version's own major.minor line.
 * This is the `--target patch` policy: never crosses a minor (or major) boundary, and never
 * leaves the declared range either — `^0.0.3` allows no newer patch.
 */
export function findHighestPatchVersion(
  installedVersion: string,
  allVersions: string[]
): string | null {
  const installed = parseCurrentVersion(installedVersion)
  if (!installed) {
    return null
  }
  const nextMinor = `${installed.major}.${installed.minor + 1}.0-0`
  const rangeCeiling = rangeTargetCeiling(installedVersion, installed)
  return newestBelow(
    installed,
    allVersions,
    semver.lt(rangeCeiling, nextMinor) ? rangeCeiling : nextMinor
  )
}

/**
 * One full version, bare or behind `^`, `~`, `>=` or `=` (a leading `v` is tolerated, as npm
 * does). The capture is checked with semver.valid, which rejects partials, x-ranges and tags.
 */
const SIMPLE_SPECIFIER = /^(?:\^|~|>=|=)?(v?\d\S*)$/

/**
 * Whether inup can upgrade this specifier by swapping in a new version and keeping the prefix.
 * Only a single simple comparator keeps its meaning that way. `||` unions, hyphen and x-ranges,
 * partials and tags would lose a bound or turn into an exact pin; `>` would exclude the new
 * version itself and `<`/`<=` are ceilings, not floors; protocols, git refs and paths
 * (`workspace:`, `npm:`, `patch:`, `jsr:`, `user/repo#v1.2.3`, `../pkg`, …) are not registry
 * versions at all. All of those are left exactly as written.
 */
export function isSimpleVersionSpecifier(specifier: string): boolean {
  const match = SIMPLE_SPECIFIER.exec(specifier)
  return match !== null && semver.valid(match[1]) !== null
}

/**
 * Re-apply the original specifier's prefix (^, ~, >=, =, v) to a new version. Only correct for
 * specifiers that pass isSimpleVersionSpecifier: the detector skips every other shape, so none
 * of them can be selected for an upgrade.
 */
export function applyVersionPrefix(originalSpecifier: string, targetVersion: string): string {
  const prefixMatch = originalSpecifier.match(/^([^\d]+)/)
  const prefix = prefixMatch ? prefixMatch[1] : ''
  return prefix + targetVersion
}
