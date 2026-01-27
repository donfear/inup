import { Pool, request } from 'undici'
import * as semver from 'semver'
import { CACHE_TTL, JSDELIVR_CDN_URL, MAX_CONCURRENT_REQUESTS, REQUEST_TIMEOUT } from '../constants'
import { getAllPackageData } from './npm-registry'

// Create a persistent connection pool for jsDelivr CDN with optimal settings
// This enables connection reuse and HTTP/1.1 keep-alive for blazing fast requests
const jsdelivrPool = new Pool('https://cdn.jsdelivr.net', {
  connections: MAX_CONCURRENT_REQUESTS, // Maximum concurrent connections
  pipelining: 10, // Enable request pipelining for even better performance
  keepAliveTimeout: 60000, // Keep connections alive for 60 seconds
  keepAliveMaxTimeout: 600000, // Maximum keep-alive timeout
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
 * Fetches package data from jsdelivr CDN with fallback to npm registry.
 * Makes simultaneous requests for @latest, @major version, and current version.
 * @param packageName - The npm package name
 * @param currentVersion - The current version to extract major from (optional)
 * @returns Package data with latest version and all versions
 */
async function fetchPackageFromJsdelivr(
  packageName: string,
  currentVersion?: string
): Promise<{ latestVersion: string; allVersions: string[] }> {
  // Check cache first
  const cached = packageCache.get(packageName)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  try {
    // Coerce the current version in case it's a range like ^1.1.5
    const coercedVersion = currentVersion ? semver.coerce(currentVersion)?.version : null

    // Determine major version from current version if provided
    const majorVersion = currentVersion
      ? semver.major(semver.coerce(currentVersion) || '0.0.0').toString()
      : null

    // Prepare requests: always fetch @latest, @major if we have a current version, and @currentVersion
    const requests: Array<Promise<{ version: string } | null>> = [
      fetchPackageJsonFromJsdelivr(packageName, 'latest'),
    ]

    if (majorVersion) {
      requests.push(fetchPackageJsonFromJsdelivr(packageName, majorVersion))
    }

    if (coercedVersion) {
      requests.push(fetchPackageJsonFromJsdelivr(packageName, coercedVersion))
    }

    // Execute all requests simultaneously
    const results = await Promise.all(requests)

    const latestResult = results[0]
    const majorResult = results[1]
    const currentResult = results[2]

    if (!latestResult) {
      // jsdelivr doesn't have this package, fallback to npm registry
      const npmData = await getAllPackageData([packageName])
      const data = npmData.get(packageName) || { latestVersion: 'unknown', allVersions: [] }

      // Cache the result
      packageCache.set(packageName, {
        data,
        timestamp: Date.now(),
      })

      return data
    }

    const latestVersion = latestResult.version
    const allVersions = [latestVersion]

    // Add the major version result if different from latest
    if (majorResult && majorResult.version !== latestVersion) {
      allVersions.push(majorResult.version)
    }

    // Add the current version result if different from latest and major
    if (currentResult && !allVersions.includes(currentResult.version)) {
      allVersions.push(currentResult.version)
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

    return result
  } catch (error) {
    // Fallback to npm registry on any error
    const npmData = await getAllPackageData([packageName])
    const data = npmData.get(packageName) || { latestVersion: 'unknown', allVersions: [] }

    // Cache the result
    packageCache.set(packageName, {
      data,
      timestamp: Date.now(),
    })

    return data
  }
}

/**
 * Fetches package version data from jsdelivr CDN for multiple packages.
 * Uses undici connection pool for blazing fast performance with connection reuse.
 * Falls back to npm registry if jsdelivr doesn't have the package.
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

  // Fire all requests simultaneously - undici pool handles concurrency internally
  // No need for p-limit - the pool's connection limit controls concurrency
  const allPromises = packageNames.map(async (packageName) => {
    const currentVersion = currentVersions?.get(packageName)
    const data = await fetchPackageFromJsdelivr(packageName, currentVersion)
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
export function clearJsdelivrPackageCache(): void {
  packageCache.clear()
}

/**
 * Close the jsDelivr connection pool (useful for graceful shutdown)
 */
export async function closeJsdelivrPool(): Promise<void> {
  await jsdelivrPool.close()
}
