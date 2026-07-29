import * as semver from 'semver'
import { extractEnginesNode, normalizeDeprecatedMessage } from './manifest'

export function extractMajorVersion(version: string | undefined): string | null {
  if (!version) return null
  const coerced = semver.coerce(version)
  if (!coerced) return null
  return semver.major(coerced).toString()
}

export function toComparableVersion(version: string): string | null {
  const validVersion = semver.valid(version)
  if (validVersion) return validVersion
  const coerced = semver.coerce(version)
  return coerced ? coerced.version : null
}

export function versionIdentity(version: string): string {
  const comparable = toComparableVersion(version)
  return comparable ?? `raw:${version}`
}

export interface ParsedVersions {
  latestVersion: string
  allVersions: string[]
  // Prerelease versions (any tag: alpha/beta/rc/preview/…), sorted descending.
  // Optional: entries cached before this field existed lack it.
  prereleaseVersions?: string[]
  deprecated?: string // npm deprecation message for the latest version, if any
  enginesNode?: string // declared engines.node range for the latest version, if any
}

export function parseVersions(raw: string): ParsedVersions {
  const data = JSON.parse(raw) as { versions?: Record<string, unknown> }
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

  // Surface health signals for the latest version straight from the abbreviated
  // packument we already fetched — no extra request. Both fields are optional.
  const latestManifest = versions[latestVersion] as
    | { deprecated?: unknown; engines?: unknown }
    | undefined
  const deprecated = normalizeDeprecatedMessage(latestManifest?.deprecated)
  const enginesNode = extractEnginesNode(latestManifest?.engines)

  return { latestVersion, allVersions, prereleaseVersions, deprecated, enginesNode }
}

/**
 * Extract the concrete installed version from a package.json specifier without
 * losing a prerelease tag: semver.coerce('^1.0.0-beta.2') drops the '-beta.2',
 * so ranges go through minVersion first. coerce stays as the last resort for
 * malformed input. Note: for open ranges like '>2.0.0' minVersion yields 2.0.1
 * (the lowest version actually allowed) where coerce yielded 2.0.0.
 */
export function parseCurrentVersion(specifier: string): semver.SemVer | null {
  const exact = semver.valid(specifier.trim())
  if (exact) return semver.parse(exact)
  try {
    const min = semver.minVersion(specifier)
    if (min) return min
  } catch {
    // Not a parseable range — fall through to coerce.
  }
  return semver.coerce(specifier)
}

/** Whether a specifier pins a prerelease (e.g. '^1.0.0-beta.2', '16.0.0-preview.9'). */
export function isPrereleaseCurrent(specifier: string): boolean {
  return (parseCurrentVersion(specifier)?.prerelease.length ?? 0) > 0
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

/**
 * Checks if a version is outdated compared to the latest version.
 * Handles version prefixes (^, ~, >=, etc.) and preserves prerelease tags,
 * so '1.0.0-beta.2' is correctly outdated against '1.0.0-rc.3'.
 */
export function isVersionOutdated(current: string, latest: string): boolean {
  try {
    const cleanCurrent = parseCurrentVersion(current)?.version || current
    const cleanLatest = toComparableVersion(latest) || latest

    return semver.gt(cleanLatest, cleanCurrent)
  } catch {
    return false
  }
}

/**
 * Get the optimized range version for a package
 */
export function getOptimizedRangeVersion(
  _packageName: string,
  currentRange: string,
  allVersions: string[],
  latestVersion: string
): string {
  try {
    // Find the highest version that satisfies the current range. satisfies()
    // returns false (never throws) for invalid input, so no guard is needed.
    const satisfyingVersions = allVersions.filter((version: string) =>
      semver.satisfies(version, currentRange)
    )

    if (satisfyingVersions.length === 0) {
      return latestVersion
    }

    // Return the highest satisfying version
    return satisfyingVersions.sort(semver.rcompare)[0]
  } catch {
    return latestVersion
  }
}

/**
 * Find the closest minor version (same major, higher minor) that satisfies the current range
 * Falls back to patch updates if no minor updates are available
 */
export function findClosestMinorVersion(
  installedVersion: string,
  allVersions: string[]
): string | null {
  try {
    const installed = parseCurrentVersion(installedVersion)
    if (!installed) {
      return null
    }

    const installedIsStable = installed.prerelease.length === 0
    const installedMajor = installed.major
    const installedMinor = installed.minor

    let bestMinorVersion: string | null = null
    let bestMinorValue = -1

    // Single pass to find best minor version in same major
    for (const version of allVersions) {
      try {
        // A stable install is never offered a prerelease, even if one leaks
        // into the candidate list.
        if (installedIsStable && semver.prerelease(version) !== null) continue
        const major = semver.major(version)
        const minor = semver.minor(version)
        if (major === installedMajor && minor > installedMinor && minor > bestMinorValue) {
          bestMinorValue = minor
          bestMinorVersion = version
        }
      } catch {
        // Skip invalid versions
      }
    }

    if (bestMinorVersion) {
      return bestMinorVersion
    }

    // Fallback: highest patch version in the same major.minor that's higher than installed
    return findHighestPatchVersion(installedVersion, allVersions)
  } catch {
    return null
  }
}

/**
 * Find the highest patch version in the installed version's own major.minor line.
 * This is the `--target patch` policy: never crosses a minor (or major) boundary.
 */
export function findHighestPatchVersion(
  installedVersion: string,
  allVersions: string[]
): string | null {
  const installed = parseCurrentVersion(installedVersion)
  if (!installed) {
    return null
  }

  const installedIsStable = installed.prerelease.length === 0

  let bestPatchVersion: string | null = null
  for (const version of allVersions) {
    try {
      const parsed = semver.parse(version)
      if (!parsed) continue
      // A stable install is never offered a prerelease.
      if (installedIsStable && parsed.prerelease.length > 0) continue
      // Same major and minor, strictly newer. semver.gt orders prereleases
      // natively, so 1.0.0-beta.2 < 1.0.0-rc.3 < 1.0.0 all resolve correctly.
      if (
        parsed.major === installed.major &&
        parsed.minor === installed.minor &&
        semver.gt(parsed, installed)
      ) {
        if (!bestPatchVersion || semver.gt(version, bestPatchVersion)) {
          bestPatchVersion = version
        }
      }
    } catch {
      // Skip invalid versions
    }
  }

  return bestPatchVersion
}

/** Re-apply the original specifier's range prefix (^, ~, >=, …) to a new version. */
export function applyVersionPrefix(originalSpecifier: string, targetVersion: string): string {
  const prefixMatch = originalSpecifier.match(/^([^\d]+)/)
  const prefix = prefixMatch ? prefixMatch[1] : ''
  return prefix + targetVersion
}
