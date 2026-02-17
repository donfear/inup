import { Pool, request } from 'undici'
import * as semver from 'semver'
import {
  JSDELIVR_CDN_URL,
  MAX_CONCURRENT_REQUESTS,
  JSDELIVR_POOL_TIMEOUT,
  JSDELIVR_RETRY_TIMEOUTS,
  JSDELIVR_RETRY_DELAYS,
} from '../config'
import { getAllPackageData } from './npm-registry'
import { packageCache, PackageVersionData } from './cache-manager'
import { ConsoleUtils } from '../ui/utils'
import { OnBatchReadyCallback } from '../types'
import { debugLog } from '../utils'

// Batch configuration for progressive loading
const BATCH_SIZE = 5
const BATCH_TIMEOUT_MS = 500

const DEFAULT_JSDELIVR_RETRY_TIMEOUT_MS = 2000
const DEFAULT_JSDELIVR_POOL_TIMEOUT_MS = 60000
const MIN_JSDELIVR_CONNECT_TIMEOUT_MS = 500

const toPositiveInteger = (value: number): number | null => {
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }

  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : null
}

const RETRY_TIMEOUTS = (() => {
  const configured = Array.from(
    new Set(
      JSDELIVR_RETRY_TIMEOUTS.map(toPositiveInteger).filter((value): value is number => value !== null)
    )
  ).sort((a, b) => a - b)
  return configured.length > 0 ? configured : [DEFAULT_JSDELIVR_RETRY_TIMEOUT_MS]
})()

const RETRY_DELAYS = JSDELIVR_RETRY_DELAYS.map(toPositiveInteger).filter(
  (value): value is number => value !== null
)

const MAX_RETRY_AFTER_DELAY_MS = RETRY_TIMEOUTS[RETRY_TIMEOUTS.length - 1]
const RETRY_AFTER_HEADER = 'retry-after'

type ResponseHeaders = Record<string, string | string[] | undefined> | undefined

const parseRetryAfterMs = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const seconds = Number(trimmed)
  if (Number.isFinite(seconds)) {
    if (seconds <= 0) {
      return null
    }

    const delayMs = Math.floor(seconds * 1000)
    return delayMs > 0 ? delayMs : null
  }

  const dateMs = Date.parse(trimmed)
  if (Number.isNaN(dateMs)) {
    return null
  }

  const delayMs = dateMs - Date.now()
  return delayMs > 0 ? delayMs : null
}

const getHeaderValue = (headers: ResponseHeaders, name: string): string | null => {
  if (!headers) {
    return null
  }

  const direct = headers[name]
  if (typeof direct === 'string') {
    return direct
  }

  if (Array.isArray(direct)) {
    return direct.find((value) => typeof value === 'string') ?? null
  }

  const headerEntry = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === name)
  if (!headerEntry) {
    return null
  }

  const [, rawValue] = headerEntry
  if (typeof rawValue === 'string') {
    return rawValue
  }

  if (Array.isArray(rawValue)) {
    return rawValue.find((value) => typeof value === 'string') ?? null
  }

  return null
}

const getRetryAfterDelay = (headers: ResponseHeaders): number | null => {
  const retryAfterValue = getHeaderValue(headers, RETRY_AFTER_HEADER)
  if (!retryAfterValue) {
    return null
  }

  const parsedDelay = parseRetryAfterMs(retryAfterValue)
  if (parsedDelay === null) {
    return null
  }

  return Math.min(parsedDelay, MAX_RETRY_AFTER_DELAY_MS)
}

const getRetryDelay = (attempt: number, headers?: ResponseHeaders): number => {
  const configuredDelay =
    RETRY_DELAYS.length === 0 ? 0 : RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]
  const retryAfterDelay = getRetryAfterDelay(headers)
  return retryAfterDelay === null ? configuredDelay : Math.max(configuredDelay, retryAfterDelay)
}

// Keep connection setup bounded by retry budget so fallback stays responsive.
const JSDELIVR_CONNECT_TIMEOUT_MS = Math.max(RETRY_TIMEOUTS[0], MIN_JSDELIVR_CONNECT_TIMEOUT_MS)
const JSDELIVR_POOL_TIMEOUT_MS =
  toPositiveInteger(JSDELIVR_POOL_TIMEOUT) ?? DEFAULT_JSDELIVR_POOL_TIMEOUT_MS
const JSDELIVR_CONNECTIONS = toPositiveInteger(MAX_CONCURRENT_REQUESTS) ?? 1

// Create a persistent connection pool for jsDelivr CDN with optimal settings
// This enables connection reuse and HTTP/1.1 keep-alive for blazing fast requests
const jsdelivrPool = new Pool('https://cdn.jsdelivr.net', {
  connections: JSDELIVR_CONNECTIONS,
  pipelining: 10,
  keepAliveTimeout: JSDELIVR_POOL_TIMEOUT_MS,
  keepAliveMaxTimeout: JSDELIVR_POOL_TIMEOUT_MS,
  connectTimeout: JSDELIVR_CONNECT_TIMEOUT_MS,
})

const isTimeoutError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }

  const maybeCode = (error as Error & { code?: string }).code
  const message = error.message.toLowerCase()
  return (
    maybeCode === 'UND_ERR_HEADERS_TIMEOUT' ||
    maybeCode === 'UND_ERR_BODY_TIMEOUT' ||
    maybeCode === 'UND_ERR_CONNECT_TIMEOUT' ||
    error.name === 'HeadersTimeoutError' ||
    error.name === 'BodyTimeoutError' ||
    error.name === 'ConnectTimeoutError' ||
    message.includes('timeout')
  )
}

const isTransientNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }

  const maybeCode = (error as Error & { code?: string }).code
  return (
    maybeCode === 'UND_ERR_SOCKET' ||
    maybeCode === 'ENOTFOUND' ||
    maybeCode === 'EAI_AGAIN' ||
    maybeCode === 'ECONNRESET' ||
    maybeCode === 'ECONNREFUSED' ||
    maybeCode === 'ETIMEDOUT' ||
    maybeCode === 'EPIPE'
  )
}

const isRetryableStatus = (statusCode: number): boolean =>
  statusCode === 408 || statusCode === 429 || statusCode >= 500

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const consumeBodySafely = async (body: { text: () => Promise<string> }): Promise<void> => {
  try {
    await body.text()
  } catch {
    // Ignore body read errors on non-200 responses because request will be retried/fallback.
  }
}

const extractMajorVersion = (version: string | undefined): string | null => {
  if (!version) {
    return null
  }

  const coerced = semver.coerce(version)
  if (!coerced) {
    return null
  }

  return semver.major(coerced).toString()
}

const toComparableVersion = (version: string): string | null => {
  const validVersion = semver.valid(version)
  if (validVersion) {
    return validVersion
  }

  const coerced = semver.coerce(version)
  return coerced ? coerced.version : null
}

const versionIdentity = (version: string): string => {
  const comparable = toComparableVersion(version)
  return comparable ?? `raw:${version}`
}

const sortVersionsDescending = (versions: string[]): string[] => {
  const uniqueVersions: string[] = []
  const seenVersions = new Set<string>()

  for (const version of versions) {
    const identity = versionIdentity(version)
    if (!seenVersions.has(identity)) {
      seenVersions.add(identity)
      uniqueVersions.push(version)
    }
  }

  return uniqueVersions.sort((a, b) => {
    const comparableA = toComparableVersion(a)
    const comparableB = toComparableVersion(b)

    if (comparableA && comparableB) {
      return semver.rcompare(comparableA, comparableB)
    }

    if (comparableA) {
      return -1
    }

    if (comparableB) {
      return 1
    }

    return b.localeCompare(a)
  })
}

const isExpectedTransientError = (error: unknown): boolean =>
  isTimeoutError(error) || isTransientNetworkError(error)

/**
 * Fetches package.json from jsdelivr CDN for a specific version tag using undici pool.
 * Uses connection pooling and keep-alive for maximum performance.
 * Retries on transient failures while keeping a short fallback budget.
 * @param packageName - The npm package name
 * @param versionTag - The version tag (e.g., '14', 'latest')
 * @returns The package.json content or null if not found
 */
async function fetchPackageJsonFromJsdelivr(
  packageName: string,
  versionTag: string
): Promise<{ version: string } | null> {
  const url = `${JSDELIVR_CDN_URL}/${encodeURIComponent(packageName)}@${versionTag}/package.json`

  for (let attempt = 0; attempt < RETRY_TIMEOUTS.length; attempt++) {
    const timeout = RETRY_TIMEOUTS[attempt]
    const tReq = Date.now()
    try {
      const { statusCode, headers, body } = await request(url, {
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
        await consumeBodySafely(body)
        if (isRetryableStatus(statusCode) && attempt < RETRY_TIMEOUTS.length - 1) {
          const delay = getRetryDelay(attempt, headers as ResponseHeaders)
          debugLog.warn('jsdelivr', `${packageName}@${versionTag} HTTP ${statusCode}, retry ${attempt + 1} in ${delay}ms`)
          if (delay > 0) {
            await sleep(delay)
          }
          continue
        }
        debugLog.warn('jsdelivr', `${packageName}@${versionTag} HTTP ${statusCode}, no more retries`)
        return null
      }

      const text = await body.text()
      const data = JSON.parse(text) as { version?: unknown }
      const version = typeof data.version === 'string' ? data.version.trim() : ''
      debugLog.perf('jsdelivr', `fetch ${packageName}@${versionTag} → ${version || 'no version'}`, tReq)
      return version ? { version } : null
    } catch (error) {
      if (
        (isTimeoutError(error) || isTransientNetworkError(error)) &&
        attempt < RETRY_TIMEOUTS.length - 1
      ) {
        const delay = getRetryDelay(attempt)
        debugLog.warn('jsdelivr', `${packageName}@${versionTag} transient error on attempt ${attempt + 1}, retry in ${delay}ms`, error)
        if (delay > 0) {
          await sleep(delay)
        }
        continue
      }

      if (!isExpectedTransientError(error)) {
        // Unexpected errors are logged for observability.
        console.error(
          `jsDelivr fetch failed for ${packageName}@${versionTag} on attempt ${attempt + 1}/${RETRY_TIMEOUTS.length}`,
          error
        )
        debugLog.error('jsdelivr', `unexpected error for ${packageName}@${versionTag} attempt ${attempt + 1}`, error)
      } else {
        debugLog.warn('jsdelivr', `${packageName}@${versionTag} exhausted retries`, error)
      }
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
  let progressCallback = onProgress
  let batchReadyCallback = onBatchReady

  // Batch buffer for progressive updates
  let batchBuffer: Array<{ name: string; data: PackageVersionData }> = []
  let batchTimer: NodeJS.Timeout | null = null

  const emitProgress = (packageName: string, completed: number, packageTotal: number) => {
    if (!progressCallback) {
      return
    }

    try {
      progressCallback(packageName, completed, packageTotal)
    } catch (error) {
      console.error('Progress callback failed, disabling progress updates for this run.', error)
      progressCallback = undefined
    }
  }

  const emitBatch = (batch: Array<{ name: string; data: PackageVersionData }>) => {
    if (!batchReadyCallback) {
      return
    }

    try {
      batchReadyCallback(batch)
    } catch (error) {
      console.error('Batch callback failed, disabling batch updates for this run.', error)
      batchReadyCallback = undefined
    }
  }

  // Helper to flush the current batch
  const flushBatch = () => {
    if (batchBuffer.length > 0) {
      const batch = [...batchBuffer]
      batchBuffer = []
      emitBatch(batch)
    }
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
  }

  // Helper to add package to batch and flush if needed
  const addToBatch = (packageName: string, data: PackageVersionData) => {
    if (!batchReadyCallback) {
      return
    }

    batchBuffer.push({ name: packageName, data })

    // Flush if batch is full
    if (batchBuffer.length >= BATCH_SIZE) {
      flushBatch()
    } else if (!batchTimer) {
      // Set timer to flush batch after timeout
      batchTimer = setTimeout(flushBatch, BATCH_TIMEOUT_MS)
    }
  }

  // Process individual package fetch with immediate npm fallback on failure
  const inFlightLookups = new Map<string, Promise<PackageVersionData | null>>()

  const fetchFromNpmFallback = async (packageName: string): Promise<PackageVersionData | null> => {
    const tFallback = Date.now()
    debugLog.info('jsdelivr', `falling back to npm registry for ${packageName}`)
    try {
      const npmData = await getAllPackageData([packageName])
      const result = npmData.get(packageName) ?? null

      if (result) {
        packageCache.set(packageName, result)
        debugLog.perf('jsdelivr', `npm fallback resolved ${packageName} → ${result.latestVersion}`, tFallback)
      } else {
        debugLog.warn('jsdelivr', `npm fallback returned no data for ${packageName}`)
      }

      return result
    } catch (error) {
      debugLog.error('jsdelivr', `npm fallback failed for ${packageName}`, error)
      return null
    }
  }

  const fetchFreshPackageData = async (
    packageName: string,
    currentVersion: string | undefined
  ): Promise<PackageVersionData | null> => {
    try {
      const majorVersion = extractMajorVersion(currentVersion)

      const latestResult = await fetchPackageJsonFromJsdelivr(packageName, 'latest')
      if (!latestResult) {
        return await fetchFromNpmFallback(packageName)
      }

      const latestVersion = latestResult.version
      const latestMajorVersion = extractMajorVersion(latestVersion)
      const shouldFetchMajorVersion = Boolean(
        majorVersion && (latestMajorVersion === null || majorVersion !== latestMajorVersion)
      )
      const majorResult = shouldFetchMajorVersion
        ? await fetchPackageJsonFromJsdelivr(packageName, majorVersion as string)
        : null
      const allVersions = [latestVersion]

      if (majorResult && majorResult.version !== latestVersion) {
        allVersions.push(majorResult.version)
      }

      const sortedVersions = sortVersionsDescending(allVersions)
      const orderedVersions =
        sortedVersions[0] === latestVersion
          ? sortedVersions
          : [latestVersion, ...sortedVersions.filter((version) => version !== latestVersion)]

      const result: PackageVersionData = {
        latestVersion,
        allVersions: orderedVersions,
      }

      packageCache.set(packageName, result)
      return result
    } catch {
      return await fetchFromNpmFallback(packageName)
    }
  }

  const getPackageData = async (
    packageName: string,
    currentVersion: string | undefined
  ): Promise<PackageVersionData | null> => {
    const cached = packageCache.get(packageName)
    if (cached) {
      debugLog.info('jsdelivr', `cache hit: ${packageName} → ${cached.latestVersion}`)
      return cached
    }

    const inFlight = inFlightLookups.get(packageName)
    if (inFlight) {
      return await inFlight
    }

    const lookupPromise = fetchFreshPackageData(packageName, currentVersion).finally(() => {
      inFlightLookups.delete(packageName)
    })
    inFlightLookups.set(packageName, lookupPromise)
    return await lookupPromise
  }

  const fetchPackageWithFallback = async (packageName: string): Promise<void> => {
    try {
      const currentVersion = currentVersions?.get(packageName)
      const result = await getPackageData(packageName, currentVersion)

      if (result) {
        packageData.set(packageName, result)
        addToBatch(packageName, result)
      }
    } catch (error) {
      console.error(`Failed to resolve package data for ${packageName}; continuing with others.`, error)
    } finally {
      completedCount++
      emitProgress(packageName, completedCount, total)
    }
  }

  try {
    // Fire all requests simultaneously - each request internally handles retries/fallback.
    await Promise.all(packageNames.map(fetchPackageWithFallback))
  } finally {
    // Flush any remaining batch items
    flushBatch()

    // Flush persistent cache to disk
    packageCache.flush()

    // Clear the progress line if no custom progress handler
    if (!onProgress) {
      ConsoleUtils.clearProgress()
    }
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
