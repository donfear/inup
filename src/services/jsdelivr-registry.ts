import { Pool, request } from 'undici'
import * as semver from 'semver'
import {
  JSDELIVR_CDN_URL,
  MAX_CONCURRENT_REQUESTS,
  REQUEST_TIMEOUT,
  JSDELIVR_RETRY_TIMEOUTS,
  JSDELIVR_RETRY_DELAYS,
  PER_PACKAGE_TIMEOUT,
} from '../config'
import { getAllPackageData } from './npm-registry'
import { packageCache, PackageVersionData } from './cache-manager'
import { ConsoleUtils } from '../ui/utils'
import { OnBatchReadyCallback } from '../types'

// Create a persistent connection pool for jsDelivr CDN with optimal settings
// This enables connection reuse and HTTP/1.1 keep-alive for blazing fast requests
const jsdelivrPool = new Pool('https://cdn.jsdelivr.net', {
  connections: MAX_CONCURRENT_REQUESTS,
  pipelining: 10,
  keepAliveTimeout: REQUEST_TIMEOUT,
  keepAliveMaxTimeout: REQUEST_TIMEOUT,
  connectTimeout: REQUEST_TIMEOUT,
})

// Batch configuration for progressive loading
const BATCH_SIZE = 5
const BATCH_TIMEOUT_MS = 500

/**
 * Fetches package.json from jsdelivr CDN for a specific version tag using undici pool.
 * Uses connection pooling and keep-alive for maximum performance.
 * Retries on timeout to allow CDN cache warming — the first request triggers caching,
 * and subsequent retries hit the warm cache.
 * @param packageName - The npm package name
 * @param versionTag - The version tag (e.g., '14', 'latest')
 * @returns The package.json content or null if not found
 */
async function fetchPackageJsonFromJsdelivr(
  packageName: string,
  versionTag: string
): Promise<{ version: string } | null> {
  const url = `${JSDELIVR_CDN_URL}/${encodeURIComponent(packageName)}@${versionTag}/package.json`

  for (let attempt = 0; attempt < JSDELIVR_RETRY_TIMEOUTS.length; attempt++) {
    const timeout = JSDELIVR_RETRY_TIMEOUTS[attempt]
    try {
      const { statusCode, body } = await request(url, {
        dispatcher: jsdelivrPool,
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
        headersTimeout: timeout,
        bodyTimeout: timeout,
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
      const isTimeout =
        error instanceof Error &&
        (error.message.includes('timeout') ||
          error.message.includes('Timeout') ||
          error.name === 'HeadersTimeoutError' ||
          error.name === 'BodyTimeoutError')

      if (isTimeout && attempt < JSDELIVR_RETRY_TIMEOUTS.length - 1) {
        // Wait before retrying — CDN should be caching the response
        const delay =
          JSDELIVR_RETRY_DELAYS[attempt] || JSDELIVR_RETRY_DELAYS[JSDELIVR_RETRY_DELAYS.length - 1]
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      // Non-timeout error or final attempt — give up
      return null
    }
  }

  return null
}

/**
 * Fetches package version data from jsdelivr CDN for multiple packages.
 * Uses undici connection pool for blazing fast performance with connection reuse.
 * Falls back to npm registry immediately when jsdelivr fails (interleaved, not sequential).
 * Supports batched callbacks for progressive UI updates.
 * @param packageNames - Array of package names to fetch
 * @param currentVersions - Optional map of package names to their current versions
 * @param onProgress - Optional progress callback
 * @param onBatchReady - Optional callback for batch updates (fires every BATCH_SIZE packages or BATCH_TIMEOUT_MS)
 * @returns Map of package names to their version data
 */
export async function getAllPackageDataFromJsdelivr(
  packageNames: string[],
  currentVersions?: Map<string, string>,
  onProgress?: (currentPackage: string, completed: number, total: number) => void,
  onBatchReady?: OnBatchReadyCallback
): Promise<Map<string, PackageVersionData>> {
  const packageData = new Map<string, PackageVersionData>()

  if (packageNames.length === 0) {
    return packageData
  }

  const total = packageNames.length
  let completedCount = 0

  // Batch buffer for progressive updates
  let batchBuffer: Array<{ name: string; data: PackageVersionData }> = []
  let batchTimer: NodeJS.Timeout | null = null

  // Helper to flush the current batch
  const flushBatch = () => {
    if (batchBuffer.length > 0 && onBatchReady) {
      onBatchReady([...batchBuffer])
      batchBuffer = []
    }
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
  }

  // Helper to add package to batch and flush if needed
  const addToBatch = (packageName: string, data: PackageVersionData) => {
    if (onBatchReady) {
      batchBuffer.push({ name: packageName, data })

      // Flush if batch is full
      if (batchBuffer.length >= BATCH_SIZE) {
        flushBatch()
      } else if (!batchTimer) {
        // Set timer to flush batch after timeout
        batchTimer = setTimeout(flushBatch, BATCH_TIMEOUT_MS)
      }
    }
  }

  // Track which packages have been timed out so background work doesn't double-count
  const timedOut = new Set<string>()

  // Process individual package fetch with immediate npm fallback on failure
  const fetchPackageWithFallback = async (packageName: string): Promise<void> => {
    const currentVersion = currentVersions?.get(packageName)

    // Use CacheManager for unified caching (memory + disk)
    const cached = packageCache.get(packageName)
    if (cached) {
      packageData.set(packageName, cached)
      completedCount++
      if (onProgress) {
        onProgress(packageName, completedCount, total)
      }
      addToBatch(packageName, cached)
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

      // If timed out while waiting, don't update progress (already counted)
      if (timedOut.has(packageName)) return

      const latestResult = results[0]
      const majorResult = results[1]

      if (!latestResult) {
        // Package not on jsDelivr, immediately try npm fallback
        const npmData = await getAllPackageData([packageName])
        if (timedOut.has(packageName)) return
        const result = npmData.get(packageName)

        if (result) {
          packageData.set(packageName, result)
          packageCache.set(packageName, result)
          addToBatch(packageName, result)
        }

        completedCount++
        if (onProgress) {
          onProgress(packageName, completedCount, total)
        }
        return
      }

      const latestVersion = latestResult.version
      const allVersions = [latestVersion]

      // Add the major version result if different from latest
      if (majorResult && majorResult.version !== latestVersion) {
        allVersions.push(majorResult.version)
      }

      const result: PackageVersionData = {
        latestVersion,
        allVersions: allVersions.sort(semver.rcompare),
      }

      packageCache.set(packageName, result)
      packageData.set(packageName, result)
      completedCount++

      if (onProgress) {
        onProgress(packageName, completedCount, total)
      }
      addToBatch(packageName, result)
    } catch (error) {
      if (timedOut.has(packageName)) return

      // On error, immediately try npm fallback
      try {
        const npmData = await getAllPackageData([packageName])
        if (timedOut.has(packageName)) return
        const result = npmData.get(packageName)

        if (result) {
          packageData.set(packageName, result)
          packageCache.set(packageName, result)
          addToBatch(packageName, result)
        }
      } catch (npmError) {
        // If both fail, just continue
      }

      completedCount++
      if (onProgress) {
        onProgress(packageName, completedCount, total)
      }
    }
  }

  // Fire all requests simultaneously with a per-package timeout cap
  // This ensures no single slow package can hold up the entire batch
  await Promise.all(
    packageNames.map((packageName) => {
      let timer: NodeJS.Timeout
      return Promise.race([
        fetchPackageWithFallback(packageName).finally(() => clearTimeout(timer)),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            // If this package hasn't completed yet, mark it timed out and skip
            if (!packageData.has(packageName)) {
              timedOut.add(packageName)
              completedCount++
              if (onProgress) {
                onProgress(packageName, completedCount, total)
              }
            }
            resolve()
          }, PER_PACKAGE_TIMEOUT)
        }),
      ])
    })
  )

  // Flush any remaining batch items
  flushBatch()

  // Flush persistent cache to disk
  packageCache.flush()

  // Clear the progress line if no custom progress handler
  if (!onProgress) {
    ConsoleUtils.clearProgress()
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
