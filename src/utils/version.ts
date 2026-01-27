import * as semver from 'semver'

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
  packageName: string,
  currentRange: string,
  allVersions: string[],
  latestVersion: string
): string {
  try {
    // Find the highest version that satisfies the current range
    const satisfyingVersions = allVersions.filter((version: string) => {
      try {
        return semver.satisfies(version, currentRange)
      } catch {
        return false
      }
    })

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
