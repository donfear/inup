import { execSync } from 'child_process'
import * as semver from 'semver'
import { REQUEST_TIMEOUT } from '../constants'

export interface VersionCheckResult {
  currentVersion: string
  latestVersion: string
  isOutdated: boolean
  updateCommand: string
}

/**
 * Check if the current package version is outdated compared to npm registry
 */
export async function checkForUpdate(
  packageName: string,
  currentVersion: string
): Promise<VersionCheckResult | null> {
  try {
    // Use npm view to get the latest version from registry
    const result = execSync(`npm view ${packageName} version`, {
      encoding: 'utf-8',
      timeout: REQUEST_TIMEOUT,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const latestVersion = result.trim()

    // Compare versions
    const isOutdated = semver.lt(currentVersion, latestVersion)

    // Determine update command based on how the tool was likely invoked
    // Check if we're running via npx (node_modules/.bin path indicates local/npx)
    const isNpx = process.argv[1]?.includes('.npm') || process.argv[1]?.includes('_npx')

    const updateCommand = isNpx ? `npx inup@latest` : `npm install -g inup@latest`

    return {
      currentVersion,
      latestVersion,
      isOutdated,
      updateCommand,
    }
  } catch (error) {
    // Silently fail - don't interrupt the user experience
    return null
  }
}

/**
 * Check for updates in the background without blocking
 * Resolves immediately, result available via promise
 */
export function checkForUpdateAsync(
  packageName: string,
  currentVersion: string
): Promise<VersionCheckResult | null> {
  return new Promise((resolve) => {
    // Set a timeout to prevent hanging
    const timeout = setTimeout(() => {
      resolve(null)
    }, 5000)

    checkForUpdate(packageName, currentVersion)
      .then((result) => {
        clearTimeout(timeout)
        resolve(result)
      })
      .catch(() => {
        clearTimeout(timeout)
        resolve(null)
      })
  })
}
