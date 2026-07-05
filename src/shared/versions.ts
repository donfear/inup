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
}

export function parseVersions(raw: string): ParsedVersions {
  const data = JSON.parse(raw) as { versions?: Record<string, unknown> }
  const versions = data.versions || {}
  const allVersions = Object.keys(versions).filter((v) => /^[0-9]+\.[0-9]+\.[0-9]+$/.test(v))
  const sortedVersions = allVersions.sort(semver.rcompare)
  const latestVersion = sortedVersions.length > 0 ? sortedVersions[0] : 'unknown'

  // Surface health signals for the latest version straight from the abbreviated
  // packument we already fetched — no extra request. Both fields are optional.
  const latestManifest = versions[latestVersion] as
    | { deprecated?: unknown; engines?: unknown }
    | undefined
  const deprecated = normalizeDeprecatedMessage(latestManifest?.deprecated)
  const enginesNode = extractEnginesNode(latestManifest?.engines)

  return { latestVersion, allVersions, deprecated, enginesNode }
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
