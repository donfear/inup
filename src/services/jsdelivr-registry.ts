import { Pool, request } from 'undici'
import * as semver from 'semver'
import type { PackageVersionData } from './npm-registry'
import {
  JSDELIVR_CDN_URL,
  MAX_CONCURRENT_REQUESTS,
  JSDELIVR_POOL_TIMEOUT,
  JSDELIVR_RETRY_TIMEOUTS,
  JSDELIVR_RETRY_DELAYS,
  NPM_REGISTRY_URL,
  REQUEST_TIMEOUT,
} from '../config'
import { debugLog } from '../utils'

const DEFAULT_JSDELIVR_RETRY_TIMEOUT_MS = 2000
const DEFAULT_JSDELIVR_POOL_TIMEOUT_MS = 60000
const MIN_JSDELIVR_CONNECT_TIMEOUT_MS = 500
const EXACT_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

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
      JSDELIVR_RETRY_TIMEOUTS.map(toPositiveInteger).filter(
        (value): value is number => value !== null
      )
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

  const headerEntry = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name
  )
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
 * Fetches a package.json manifest from jsDelivr for a version tag.
 */
async function fetchPackageManifestFromJsdelivr(
  packageName: string,
  versionTag: string
): Promise<Record<string, unknown> | null> {
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
          debugLog.warn(
            'jsdelivr',
            `${packageName}@${versionTag} HTTP ${statusCode}, retry ${attempt + 1} in ${delay}ms`
          )
          if (delay > 0) {
            await sleep(delay)
          }
          continue
        }
        debugLog.warn(
          'jsdelivr',
          `${packageName}@${versionTag} HTTP ${statusCode}, no more retries`
        )
        return null
      }

      const text = await body.text()
      const data = JSON.parse(text) as unknown
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return null
      }

      debugLog.perf('jsdelivr', `fetch manifest ${packageName}@${versionTag}`, tReq)
      return data as Record<string, unknown>
    } catch (error) {
      if (
        (isTimeoutError(error) || isTransientNetworkError(error)) &&
        attempt < RETRY_TIMEOUTS.length - 1
      ) {
        const delay = getRetryDelay(attempt)
        debugLog.warn(
          'jsdelivr',
          `${packageName}@${versionTag} transient error on attempt ${attempt + 1}, retry in ${delay}ms`,
          error
        )
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
        debugLog.error(
          'jsdelivr',
          `unexpected error for ${packageName}@${versionTag} attempt ${attempt + 1}`,
          error
        )
      } else {
        debugLog.warn('jsdelivr', `${packageName}@${versionTag} exhausted retries`, error)
      }
      return null
    }
  }

  return null
}

async function fetchPackageManifestFromNpmRegistry(
  packageName: string,
  version: string
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  try {
    const response = await fetch(
      `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
        signal: controller.signal,
      }
    )

    if (!response.ok) {
      return null
    }

    return (await response.json()) as Record<string, unknown>
  } catch (error) {
    debugLog.warn('npm-registry', `exact manifest fallback failed for ${packageName}@${version}`, error)
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

const inFlightManifests = new Map<string, Promise<Record<string, unknown> | null>>()

export async function fetchExactPackageManifest(
  packageName: string,
  version: string
): Promise<Record<string, unknown> | null> {
  const normalizedVersion = version.trim()
  if (!EXACT_VERSION_PATTERN.test(normalizedVersion) || !semver.valid(normalizedVersion)) {
    debugLog.warn('jsdelivr', `skipping non-exact version lookup for ${packageName}@${version}`)
    return null
  }

  const cacheKey = `${packageName}@${normalizedVersion}`
  const inFlight = inFlightManifests.get(cacheKey)
  if (inFlight) {
    return await inFlight
  }

  const lookupPromise = (async () => {
    const jsdelivrManifest = await fetchPackageManifestFromJsdelivr(packageName, normalizedVersion)
    if (jsdelivrManifest) {
      return jsdelivrManifest
    }

    return await fetchPackageManifestFromNpmRegistry(packageName, normalizedVersion)
  })().finally(() => {
    inFlightManifests.delete(cacheKey)
  })
  inFlightManifests.set(cacheKey, lookupPromise)
  return await lookupPromise
}

export async function getAllPackageDataFromJsdelivr(
  packageNames: string[],
  currentVersions?: Map<string, string>,
  onProgress?: (currentPackage: string, completed: number, total: number) => void
): Promise<Map<string, PackageVersionData>> {
  const packageData = new Map<string, PackageVersionData>()

  if (packageNames.length === 0) {
    return packageData
  }

  const total = packageNames.length
  let completedCount = 0
  const inFlightLookups = new Map<string, Promise<PackageVersionData | null>>()

  const fetchPackageData = async (
    packageName: string,
    currentVersion: string | undefined
  ): Promise<PackageVersionData | null> => {
    const latestManifest = await fetchPackageManifestFromJsdelivr(packageName, 'latest')
    const latestVersion =
      typeof latestManifest?.version === 'string' ? latestManifest.version.trim() : ''
    if (!latestVersion) {
      return null
    }

    const majorVersion = extractMajorVersion(currentVersion)
    const latestMajorVersion = extractMajorVersion(latestVersion)
    const shouldFetchMajorVersion = Boolean(
      majorVersion && (latestMajorVersion === null || latestMajorVersion !== majorVersion)
    )
    const majorManifest = shouldFetchMajorVersion
      ? await fetchPackageManifestFromJsdelivr(packageName, majorVersion as string)
      : null
    const majorResolvedVersion =
      typeof majorManifest?.version === 'string' ? majorManifest.version.trim() : ''

    const sortedVersions = sortVersionsDescending(
      [latestVersion, majorResolvedVersion].filter(Boolean)
    )
    const allVersions =
      sortedVersions[0] === latestVersion
        ? sortedVersions
        : [latestVersion, ...sortedVersions.filter((version) => version !== latestVersion)]

    return {
      latestVersion,
      allVersions,
    }
  }

  const getPackageData = async (
    packageName: string,
    currentVersion: string | undefined
  ): Promise<PackageVersionData | null> => {
    const inFlight = inFlightLookups.get(packageName)
    if (inFlight) {
      return await inFlight
    }

    const lookupPromise = fetchPackageData(packageName, currentVersion).finally(() => {
      inFlightLookups.delete(packageName)
    })
    inFlightLookups.set(packageName, lookupPromise)
    return await lookupPromise
  }

  await Promise.all(
    packageNames.map(async (packageName) => {
      try {
        const result = await getPackageData(packageName, currentVersions?.get(packageName))
        if (result) {
          packageData.set(packageName, result)
        }
      } finally {
        completedCount++
        onProgress?.(packageName, completedCount, total)
      }
    })
  )

  return packageData
}

/**
 * Close the jsDelivr connection pool (useful for graceful shutdown)
 */
export async function closeJsdelivrPool(): Promise<void> {
  await jsdelivrPool.close()
}

export function clearExactManifestCache(): void {
  inFlightManifests.clear()
}
