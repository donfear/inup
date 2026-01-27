import * as semver from 'semver'
import { CACHE_TTL, NPM_REGISTRY_URL, REQUEST_TIMEOUT } from '../config'

// In-memory cache for package data
interface CacheEntry {
  data: { latestVersion: string; allVersions: string[] }
  timestamp: number
}
const packageCache = new Map<string, CacheEntry>()

/**
 * Fetches package data from npm registry with caching using native fetch.
 * Includes timeout support for slow connections.
 */
async function fetchPackageFromRegistry(
  packageName: string
): Promise<{ latestVersion: string; allVersions: string[] }> {
  // Check cache first
  const cached = packageCache.get(packageName)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  try {
    const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/vnd.npm.install-v1+json',
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const text = await response.text()
      const data = JSON.parse(text) as {
        versions?: Record<string, unknown>
        description?: string
        homepage?: string
        repository?: any
        bugs?: any
        keywords?: string[]
        author?: any
        license?: string
        'dist-tags'?: Record<string, string>
      }

      // Extract versions and filter to valid semver (X.Y.Z format, no pre-releases)
      const allVersions = Object.keys(data.versions || {}).filter((version) => {
        // Match only X.Y.Z format (no pre-release, no build metadata)
        return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)
      })

      // Sort versions to find the latest
      const sortedVersions = allVersions.sort(semver.rcompare)
      const latestVersion = sortedVersions.length > 0 ? sortedVersions[0] : 'unknown'

      const result = {
        latestVersion,
        allVersions,
      }

      // Cache the result
      packageCache.set(packageName, {
        data: result,
        timestamp: Date.now(),
      })

      return result
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    // Return fallback data for failed packages
    return { latestVersion: 'unknown', allVersions: [] }
  }
}

/**
 * Fetches package version data from npm registry for multiple packages.
 * Uses native fetch with timeout support for reliable performance.
 * Only returns valid semantic versions (X.Y.Z format, excluding pre-releases).
 */
export async function getAllPackageData(
  packageNames: string[],
  onProgress?: (currentPackage: string, completed: number, total: number) => void
): Promise<Map<string, { latestVersion: string; allVersions: string[] }>> {
  const packageData = new Map<string, { latestVersion: string; allVersions: string[] }>()

  if (packageNames.length === 0) {
    return packageData
  }

  const total = packageNames.length
  let completedCount = 0

  // Fire all requests simultaneously
  // Concurrency is handled naturally by the event loop with fetch
  const allPromises = packageNames.map(async (packageName) => {
    const data = await fetchPackageFromRegistry(packageName)
    packageData.set(packageName, data)

    completedCount++

    if (onProgress) {
      onProgress(packageName, completedCount, total)
    }
  })

  // Wait for all requests to complete
  await Promise.all(allPromises)

  // Clear the progress line and show completion time if no custom progress handler
  if (!onProgress) {
    process.stdout.write('\r' + ' '.repeat(80) + '\r')
  }

  return packageData
}

/**
 * Clear the package cache (useful for testing)
 */
export function clearPackageCache(): void {
  packageCache.clear()
}
