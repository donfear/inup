import * as semver from 'semver'
import { Pool } from 'undici'
import { gunzip, inflate, brotliDecompress } from 'node:zlib'
import { promisify } from 'node:util'

const gunzipAsync = promisify(gunzip)
const inflateAsync = promisify(inflate)
const brotliDecompressAsync = promisify(brotliDecompress)
import { NPM_REGISTRY_URL, REQUEST_TIMEOUT } from '../config'
import { getAllPackageDataFromJsdelivr } from './jsdelivr-registry'
import { ConsoleUtils } from '../ui/utils'
import { OnBatchReadyCallback, RegistryBatchOptions, RegistryBatchProgressItem } from '../types'

export interface PackageVersionData {
  latestVersion: string
  allVersions: string[]
}

const inFlightLookups = new Map<string, Promise<PackageVersionData>>()

const registryOrigin = new URL(NPM_REGISTRY_URL).origin
const registryPathPrefix = new URL(NPM_REGISTRY_URL).pathname.replace(/\/$/, '')

// Few connections + many requests per connection = maximum keep-alive reuse.
// On slow links, each TLS handshake costs 1-3s, so minimizing handshakes dominates.
const registryPool = new Pool(registryOrigin, {
  connections: 6,
  pipelining: 1,
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 600_000,
  headersTimeout: REQUEST_TIMEOUT,
  bodyTimeout: REQUEST_TIMEOUT,
  connectTimeout: 10_000,
  allowH2: false,
})

// Per-attempt timeouts: fail fast on the first try, give the retry more budget,
// then hedge to jsdelivr. Total worst-case ≈ 8s + 20s before we start the fallback race.
const REGISTRY_ATTEMPT_TIMEOUTS_MS = [8_000, 20_000]
// If the registry hasn't responded within this window, race jsdelivr in parallel
// and take whichever wins. This is the main wall-clock win on slow links.
const HEDGE_DELAY_MS = 4_000
const RETRY_BACKOFF_MS = 250
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const isRetryableStatus = (statusCode: number): boolean =>
  statusCode === 408 || statusCode === 429 || statusCode >= 500

const isTransientNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }

  const maybeCode = (error as Error & { code?: string }).code
  return (
    error.name === 'AbortError' ||
    error.name === 'HeadersTimeoutError' ||
    error.name === 'BodyTimeoutError' ||
    error.name === 'ConnectTimeoutError' ||
    error.name === 'SocketError' ||
    maybeCode === 'UND_ERR_HEADERS_TIMEOUT' ||
    maybeCode === 'UND_ERR_BODY_TIMEOUT' ||
    maybeCode === 'UND_ERR_CONNECT_TIMEOUT' ||
    maybeCode === 'UND_ERR_SOCKET' ||
    maybeCode === 'ENOTFOUND' ||
    maybeCode === 'EAI_AGAIN' ||
    maybeCode === 'ECONNRESET' ||
    maybeCode === 'ECONNREFUSED' ||
    maybeCode === 'ETIMEDOUT' ||
    maybeCode === 'EPIPE'
  )
}

const fetchFromJsdelivrFallback = async (
  packageName: string,
  currentVersion: string | undefined
): Promise<PackageVersionData> => {
  const jsdelivrData = await getAllPackageDataFromJsdelivr(
    [packageName],
    currentVersion ? new Map([[packageName, currentVersion]]) : undefined
  )
  return jsdelivrData.get(packageName) ?? { latestVersion: 'unknown', allVersions: [] }
}

async function getFreshPackageData(
  packageName: string,
  currentVersion: string | undefined
): Promise<PackageVersionData> {
  const cacheKey = `${packageName}@${currentVersion ?? ''}`
  const inFlight = inFlightLookups.get(cacheKey)
  if (inFlight) {
    return await inFlight
  }

  const lookupPromise = fetchPackageFromRegistryWithFallback(packageName, currentVersion).finally(
    () => {
      inFlightLookups.delete(cacheKey)
    }
  )
  inFlightLookups.set(cacheKey, lookupPromise)
  return await lookupPromise
}

function parseVersions(raw: string): PackageVersionData {
  const data = JSON.parse(raw) as { versions?: Record<string, unknown> }
  const allVersions = Object.keys(data.versions || {}).filter((v) =>
    /^[0-9]+\.[0-9]+\.[0-9]+$/.test(v)
  )
  const sortedVersions = allVersions.sort(semver.rcompare)
  const latestVersion = sortedVersions.length > 0 ? sortedVersions[0] : 'unknown'
  return { latestVersion, allVersions }
}

const encodeRegistryPath = (packageName: string): string => {
  const encodedName = packageName.startsWith('@')
    ? `@${encodeURIComponent(packageName.slice(1).split('/')[0])}/${encodeURIComponent(
        packageName.slice(packageName.indexOf('/') + 1)
      )}`
    : encodeURIComponent(packageName)
  return `${registryPathPrefix}/${encodedName}`
}

type RegistryAttemptOutcome =
  | { kind: 'success'; data: PackageVersionData }
  | { kind: 'not-found' }
  | { kind: 'retryable' }
  | { kind: 'transient' }

async function attemptRegistryFetch(
  path: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<RegistryAttemptOutcome> {
  try {
    const { statusCode, headers, body } = await registryPool.request({
      path,
      method: 'GET',
      headers: {
        accept: 'application/vnd.npm.install-v1+json',
        'accept-encoding': 'gzip, deflate, br',
      },
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      signal,
      blocking: false,
    })

    if (statusCode < 200 || statusCode >= 300) {
      await body.dump().catch(() => undefined)
      if (isRetryableStatus(statusCode)) {
        return { kind: 'retryable' }
      }
      return { kind: 'not-found' }
    }

    const raw = Buffer.from(await body.arrayBuffer())
    const encodingHeader = headers['content-encoding']
    const encoding = (Array.isArray(encodingHeader) ? encodingHeader[0] : encodingHeader)
      ?.toString()
      .toLowerCase()
    let decoded: Buffer
    if (encoding === 'gzip') {
      decoded = await gunzipAsync(raw)
    } else if (encoding === 'br') {
      decoded = await brotliDecompressAsync(raw)
    } else if (encoding === 'deflate') {
      decoded = await inflateAsync(raw)
    } else {
      decoded = raw
    }
    return { kind: 'success', data: parseVersions(decoded.toString('utf8')) }
  } catch (error) {
    if (isTransientNetworkError(error)) {
      return { kind: 'transient' }
    }
    // Unknown error: treat as transient so we try the fallback rather than
    // silently returning 'unknown'.
    return { kind: 'transient' }
  }
}

async function fetchFromRegistryWithRetries(
  path: string,
  signal: AbortSignal
): Promise<RegistryAttemptOutcome> {
  let lastOutcome: RegistryAttemptOutcome = { kind: 'transient' }
  for (let attempt = 0; attempt < REGISTRY_ATTEMPT_TIMEOUTS_MS.length; attempt++) {
    if (signal.aborted) {
      return { kind: 'transient' }
    }
    const timeoutMs = REGISTRY_ATTEMPT_TIMEOUTS_MS[attempt]
    const outcome = await attemptRegistryFetch(path, timeoutMs, signal)
    if (outcome.kind === 'success' || outcome.kind === 'not-found') {
      return outcome
    }
    lastOutcome = outcome
    if (attempt < REGISTRY_ATTEMPT_TIMEOUTS_MS.length - 1 && !signal.aborted) {
      await sleep(RETRY_BACKOFF_MS)
    }
  }
  return lastOutcome
}

async function fetchPackageFromRegistryWithFallback(
  packageName: string,
  currentVersion: string | undefined
): Promise<PackageVersionData> {
  const path = encodeRegistryPath(packageName)
  const registryController = new AbortController()
  const fallbackController = new AbortController()

  const registryPromise = fetchFromRegistryWithRetries(path, registryController.signal).then(
    (outcome) => ({ source: 'registry' as const, outcome })
  )

  // Hedge: start jsdelivr if registry hasn't produced a usable result in HEDGE_DELAY_MS.
  let hedgeTimer: NodeJS.Timeout | null = null
  const fallbackPromise = new Promise<{
    source: 'fallback'
    data: PackageVersionData | null
  }>((resolve) => {
    hedgeTimer = setTimeout(() => {
      fetchFromJsdelivrFallback(packageName, currentVersion)
        .then((data) => resolve({ source: 'fallback', data }))
        .catch(() => resolve({ source: 'fallback', data: null }))
    }, HEDGE_DELAY_MS)
    fallbackController.signal.addEventListener('abort', () => {
      if (hedgeTimer) {
        clearTimeout(hedgeTimer)
        hedgeTimer = null
      }
      resolve({ source: 'fallback', data: null })
    })
  })

  const clearHedge = () => {
    if (hedgeTimer) {
      clearTimeout(hedgeTimer)
      hedgeTimer = null
    }
  }

  try {
    while (true) {
      const winner = await Promise.race([registryPromise, fallbackPromise])

      if (winner.source === 'registry') {
        const { outcome } = winner
        if (outcome.kind === 'success') {
          fallbackController.abort()
          clearHedge()
          return outcome.data
        }
        if (outcome.kind === 'not-found') {
          fallbackController.abort()
          clearHedge()
          return { latestVersion: 'unknown', allVersions: [] }
        }
        // Registry failed: wait for hedged fallback (already in flight or imminent).
        clearHedge()
        const fallbackResult = await fetchFromJsdelivrFallback(packageName, currentVersion).catch(
          () => null
        )
        return fallbackResult ?? { latestVersion: 'unknown', allVersions: [] }
      }

      // Fallback resolved first.
      if (winner.data) {
        registryController.abort()
        return winner.data
      }
      // Fallback failed — keep waiting on registry.
      const registryResult = await registryPromise
      if (registryResult.outcome.kind === 'success') {
        return registryResult.outcome.data
      }
      return { latestVersion: 'unknown', allVersions: [] }
    }
  } catch {
    clearHedge()
    return { latestVersion: 'unknown', allVersions: [] }
  }
}

/**
 * Fetches package version data from npm registry for multiple packages.
 * Uses an undici Pool with HTTP/1.1 pipelining for high throughput.
 * Only returns valid semantic versions (X.Y.Z format, excluding pre-releases).
 */
export async function getAllPackageData(
  packageNames: string[],
  onProgress?: (currentPackage: string, completed: number, total: number) => void,
  currentVersions?: Map<string, string>
): Promise<Map<string, PackageVersionData>> {
  const packageData = new Map<string, PackageVersionData>()

  if (packageNames.length === 0) {
    return packageData
  }

  const total = packageNames.length
  let completedCount = 0

  // Cap in-flight requests so slow links aren't saturated with hundreds of
  // concurrent sockets. Matches the pool's useful parallelism.
  await runWithConcurrencyLimit(packageNames, 10, async (packageName) => {
    const data = await getFreshPackageData(packageName, currentVersions?.get(packageName))
    packageData.set(packageName, data)

    completedCount++

    if (onProgress) {
      onProgress(packageName, completedCount, total)
    }
  })

  if (!onProgress) {
    ConsoleUtils.clearProgress()
  }

  return packageData
}

async function runWithConcurrencyLimit<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return
  }

  const limit = Math.max(1, Math.min(concurrency, items.length))
  let nextIndex = 0

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++
      await worker(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()))
}

export async function getAllPackageDataBatched(
  packageNames: string[],
  onBatchReady?: OnBatchReadyCallback,
  currentVersions?: Map<string, string>,
  options: RegistryBatchOptions = {}
): Promise<Map<string, PackageVersionData>> {
  const packageData = new Map<string, PackageVersionData>()

  if (packageNames.length === 0) {
    return packageData
  }

  const batchSizes =
    options.batchSizes && options.batchSizes.length > 0
      ? options.batchSizes.map((size) => Math.max(1, size))
      : [Math.max(1, options.batchSize ?? 20)]
  const concurrency = Math.max(1, options.concurrency ?? 5)
  const total = packageNames.length
  let completedCount = 0
  let batchStart = 0
  let batchIndex = 0

  const batchPromises: Promise<void>[] = []
  const pendingEmissions = new Map<number, RegistryBatchProgressItem[]>()
  let nextEmitIndex = 0

  const flushPending = () => {
    while (pendingEmissions.has(nextEmitIndex)) {
      const ready = pendingEmissions.get(nextEmitIndex)!
      pendingEmissions.delete(nextEmitIndex)
      onBatchReady?.(ready)
      nextEmitIndex++
    }
  }

  while (batchStart < packageNames.length) {
    const batchSize = batchSizes[Math.min(batchIndex, batchSizes.length - 1)]
    const batchNames = packageNames.slice(batchStart, batchStart + batchSize)
    const capturedBatchIndex = batchIndex
    const batchResults: RegistryBatchProgressItem[] = new Array(batchNames.length)

    const batchPromise = runWithConcurrencyLimit(
      batchNames,
      concurrency,
      async (packageName, itemIndex) => {
        const data = await getFreshPackageData(packageName, currentVersions?.get(packageName))
        packageData.set(packageName, data)
        completedCount++
        batchResults[itemIndex] = {
          packageName,
          data,
          completed: completedCount,
          total,
          batchIndex: capturedBatchIndex,
          itemIndex,
        }
      }
    ).then(() => {
      pendingEmissions.set(capturedBatchIndex, batchResults.filter(Boolean))
      flushPending()
    })

    batchPromises.push(batchPromise)
    batchStart += batchSize
    batchIndex++
  }

  await Promise.all(batchPromises)

  return packageData
}

/**
 * Retained for backward compatibility. Registry responses are fresh-by-default.
 */
export function clearPackageCache(): void {
  inFlightLookups.clear()
}

export async function closeRegistryPool(): Promise<void> {
  await registryPool.close()
}
