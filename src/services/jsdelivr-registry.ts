import { Pool, request } from 'undici'
import * as semver from 'semver'
import { CACHE_TTL, JSDELIVR_CDN_URL, MAX_CONCURRENT_REQUESTS, REQUEST_TIMEOUT } from '../config'
import { getAllPackageData } from './npm-registry'

// Create a persistent connection pool for jsDelivr CDN with optimal settings
// This enables connection reuse and HTTP/1.1 keep-alive for blazing fast requests
const jsdelivrPool = new Pool('https://cdn.jsdelivr.net', {
  connections: MAX_CONCURRENT_REQUESTS, // Maximum concurrent connections
  pipelining: 10, // Enable request pipelining for even better performance
  keepAliveTimeout: REQUEST_TIMEOUT, // Keep connections alive for 60 seconds
  keepAliveMaxTimeout: REQUEST_TIMEOUT, // Maximum keep-alive timeout
  connectTimeout: REQUEST_TIMEOUT, // 60 seconds connect timeout
})

// In-memory cache for package data
interface CacheEntry {
  data: { latestVersion: string; allVersions: string[] }
  timestamp: number
}
const packageCache = new Map<string, CacheEntry>()

/**
 * Fetches package.json from jsdelivr CDN for a specific version tag using undici pool.
 * Uses connection pooling and keep-alive for maximum performance.
 * @param packageName - The npm package name
 * @param versionTag - The version tag (e.g., '14', 'latest')
 * @returns The package.json content or null if not found
 */
async function fetchPackageJsonFromJsdelivr(
  packageName: string,
  versionTag: string
): Promise<{ version: string } | null> {
  try {
    const url = `${JSDELIVR_CDN_URL}/${encodeURIComponent(packageName)}@${versionTag}/package.json`

    const { statusCode, body } = await request(url, {
      dispatcher: jsdelivrPool,
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
      headersTimeout: REQUEST_TIMEOUT,
      bodyTimeout: REQUEST_TIMEOUT,
    })

    if (statusCode !== 200) {
      // Consume body to prevent memory leaks
      await body.text()
      return null
    }

    const text = await body.text()
    const data = JSON.parse(text) as { version?: string }
    return data.version ? { version: data.version } : null
  } catch (error) {
    console.error(`Error fetching from jsdelivr for package: ${packageName}@${versionTag}`, error)
    return null
  }
}

/**
 * Fetches package version data from jsdelivr CDN for multiple packages.
 * Uses undici connection pool for blazing fast performance with connection reuse.
 * Falls back to npm registry in batches if jsdelivr doesn't have packages.
 * @param packageNames - Array of package names to fetch
 * @param currentVersions - Optional map of package names to their current versions
 * @param onProgress - Optional progress callback
 * @returns Map of package names to their version data
 */
export async function getAllPackageDataFromJsdelivr(
  packageNames: string[],
  currentVersions?: Map<string, string>,
  onProgress?: (currentPackage: string, completed: number, total: number) => void
): Promise<Map<string, { latestVersion: string; allVersions: string[] }>> {
  const packageData = new Map<string, { latestVersion: string; allVersions: string[] }>()

  if (packageNames.length === 0) {
    return packageData
  }

  const total = packageNames.length
  let completedCount = 0

  // Track packages that need npm fallback (not found on jsDelivr)
  const failedPackages: string[] = []

  // Fire all jsDelivr requests simultaneously - undici pool handles concurrency internally
  const allPromises = packageNames.map(async (packageName) => {
    const currentVersion = currentVersions?.get(packageName)

    // Try to get from cache first
    const cached = packageCache.get(packageName)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      packageData.set(packageName, cached.data)
      completedCount++
      if (onProgress) {
        onProgress(packageName, completedCount, total)
      }
      return
    }

    try {
      // Determine major version from current version if provided
      const majorVersion = currentVersion
        ? semver.major(semver.coerce(currentVersion) || '0.0.0').toString()
        : null

      // Prepare requests: always fetch @latest, @major if we have a current version
      const requests: Array<Promise<{ version: string } | null>> = [
        fetchPackageJsonFromJsdelivr(packageName, 'latest'),
      ]

      if (majorVersion) {
        requests.push(fetchPackageJsonFromJsdelivr(packageName, majorVersion))
      }

      // Execute all requests simultaneously
      const results = await Promise.all(requests)

      const latestResult = results[0]
      const majorResult = results[1]

      if (!latestResult) {
        // Package not on jsDelivr, mark for npm fallback
        failedPackages.push(packageName)
        return
      }

      const latestVersion = latestResult.version
      const allVersions = [latestVersion]

      // Add the major version result if different from latest
      if (majorResult && majorResult.version !== latestVersion) {
        allVersions.push(majorResult.version)
      }

      const result = {
        latestVersion,
        allVersions: allVersions.sort(semver.rcompare),
      }

      // Cache the result
      packageCache.set(packageName, {
        data: result,
        timestamp: Date.now(),
      })

      packageData.set(packageName, result)
      completedCount++

      if (onProgress) {
        onProgress(packageName, completedCount, total)
      }
    } catch (error) {
      // On error, mark for npm fallback
      failedPackages.push(packageName)
    }
  })

  // Wait for all jsDelivr requests to complete
  await Promise.all(allPromises)

  // Batch fetch all failed packages from npm registry in one call
  if (failedPackages.length > 0) {
    const npmData = await getAllPackageData(failedPackages, (pkg, completed, npmTotal) => {
      completedCount++
      if (onProgress) {
        onProgress(pkg, completedCount, total)
      }
    })

    // Merge npm data into results and cache it
    for (const [packageName, data] of npmData.entries()) {
      packageData.set(packageName, data)
      packageCache.set(packageName, {
        data,
        timestamp: Date.now(),
      })
    }
  }

  // Clear the progress line and show completion time if no custom progress handler
  if (!onProgress) {
    process.stdout.write('\r' + ' '.repeat(80) + '\r')
  }

  return packageData
}

/**
 * Clear the package cache (useful for testing)
 */
export function clearJsdelivrPackageCache(): void {
  packageCache.clear()
}

/**
 * Close the jsDelivr connection pool (useful for graceful shutdown)
 */
export async function closeJsdelivrPool(): Promise<void> {
  await jsdelivrPool.close()
}
