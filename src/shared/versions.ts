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
  deprecated?: string // npm deprecation message for the latest version, if any
  enginesNode?: string // declared engines.node range for the latest version, if any
  /**
   * ISO publish timestamp per version, from the packument's `time` field. Only present when the
   * FULL packument was fetched (the abbreviated install-v1 format has no `time`), i.e. when a
   * release-age policy is active. Restricted to the versions in `allVersions`.
   */
  publishTimes?: Record<string, string>
}

export function parseVersions(raw: string): ParsedVersions {
  const data = JSON.parse(raw) as {
    versions?: Record<string, unknown>
    time?: Record<string, string>
  }
  const versions = data.versions || {}
  const allVersions = Object.keys(versions).filter((v) => /^[0-9]+\.[0-9]+\.[0-9]+$/.test(v))
  const sortedVersions = allVersions.sort(semver.rcompare)
  const latestVersion = sortedVersions.length > 0 ? sortedVersions[0] : 'unknown'

  // Publish times exist only in the full packument; keep just the entries for versions we track
  // (`time` also carries 'created'/'modified' and prerelease keys).
  let publishTimes: Record<string, string> | undefined
  if (data.time) {
    publishTimes = {}
    for (const version of allVersions) {
      const publishedAt = data.time[version]
      if (typeof publishedAt === 'string') {
        publishTimes[version] = publishedAt
      }
    }
  }

  // Surface health signals for the latest version straight from the abbreviated
  // packument we already fetched — no extra request. Both fields are optional.
  const latestManifest = versions[latestVersion] as
    | { deprecated?: unknown; engines?: unknown }
    | undefined
  const deprecated = normalizeDeprecatedMessage(latestManifest?.deprecated)
  const enginesNode = extractEnginesNode(latestManifest?.engines)

  return { latestVersion, allVersions, deprecated, enginesNode, publishTimes }
}

/**
 * Drop versions published more recently than the cooldown window (`minimumReleaseAge`, minutes).
 *
 * This is a supply-chain guard: freshly published versions are the ones most likely to be a
 * compromised release that hasn't been caught yet. Versions without a (parsable) publish
 * timestamp are kept — the policy only acts on positive evidence, so registries that don't
 * expose `time` degrade to a no-op rather than hiding everything.
 */
export function filterVersionsByReleaseAge(
  allVersions: string[],
  publishTimes: Record<string, string> | undefined,
  minimumReleaseAgeMinutes: number,
  now: number = Date.now()
): string[] {
  if (!publishTimes) return allVersions

  const cutoff = now - minimumReleaseAgeMinutes * 60_000
  return allVersions.filter((version) => {
    const publishedAt = publishTimes[version]
    if (!publishedAt) return true
    const timestamp = Date.parse(publishedAt)
    if (Number.isNaN(timestamp)) return true
    return timestamp <= cutoff
  })
}

/**
 * Checks if a version is outdated compared to the latest version.
 * Handles version prefixes (^, ~, >=, etc.) by coercing them to valid semver.
 */
export function isVersionOutdated(current: string, latest: string): boolean {
  try {
    // Remove version prefixes like ^, ~, >=, etc.
    const cleanCurrent = semver.coerce(current)?.version || current
    const cleanLatest = semver.coerce(latest)?.version || latest

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
    const coercedInstalled = semver.coerce(installedVersion)
    if (!coercedInstalled) {
      return null
    }

    const installedMajor = semver.major(coercedInstalled)
    const installedMinor = semver.minor(coercedInstalled)
    const installedPatch = semver.patch(coercedInstalled)

    let bestMinorVersion: string | null = null
    let bestMinorValue = -1

    // Single pass to find best minor version in same major
    for (const version of allVersions) {
      try {
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

    // Fallback: find highest patch version in same major.minor that's higher than installed
    let bestPatchVersion: string | null = null
    for (const version of allVersions) {
      try {
        const major = semver.major(version)
        const minor = semver.minor(version)
        const patch = semver.patch(version)
        // Same major and minor, but higher patch
        if (major === installedMajor && minor === installedMinor && patch > installedPatch) {
          if (!bestPatchVersion || semver.gt(version, bestPatchVersion)) {
            bestPatchVersion = version
          }
        }
      } catch {
        // Skip invalid versions
      }
    }

    return bestPatchVersion
  } catch {
    return null
  }
}

/** Re-apply the original specifier's range prefix (^, ~, >=, …) to a new version. */
export function applyVersionPrefix(originalSpecifier: string, targetVersion: string): string {
  const prefixMatch = originalSpecifier.match(/^([^\d]+)/)
  const prefix = prefixMatch ? prefixMatch[1] : ''
  return prefix + targetVersion
}
