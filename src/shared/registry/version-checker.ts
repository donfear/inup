import * as semver from 'semver'
import { NPM_REGISTRY_URL } from '../config'

/** Cap for the self-update check; it must never hold up an interactive session. */
const UPDATE_CHECK_TIMEOUT_MS = 5000

export interface VersionCheckResult {
  currentVersion: string
  latestVersion: string
  isOutdated: boolean
  updateCommand: string
}

/**
 * Check if the current package version is outdated compared to npm registry.
 *
 * One small registry request (`{registry}/{name}/latest`) instead of spawning
 * the npm CLI — `npm view` paid a few hundred ms of process startup for the
 * same answer.
 */
export async function checkForUpdate(
  packageName: string,
  currentVersion: string
): Promise<VersionCheckResult | null> {
  try {
    const response = await fetch(`${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}/latest`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    })
    if (!response.ok) {
      return null
    }

    const manifest = (await response.json()) as { version?: string }
    const latestVersion = typeof manifest.version === 'string' ? manifest.version.trim() : ''
    if (!semver.valid(latestVersion)) {
      return null
    }

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
