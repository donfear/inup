import * as semver from 'semver'
import { Pool } from 'undici'
import { gunzip, inflate, brotliDecompress } from 'node:zlib'
import { promisify } from 'node:util'

const gunzipAsync = promisify(gunzip)
const inflateAsync = promisify(inflate)
const brotliDecompressAsync = promisify(brotliDecompress)
import { NPM_REGISTRY_URL } from '../config'
import { getAllPackageDataFromJsdelivr } from './jsdelivr-registry'
import { ConsoleUtils } from '../ui/utils'
import {
  OnBatchReadyCallback,
  OnPackageStartCallback,
  RegistryBatchOptions,
  RegistryBatchProgressItem,
} from '../types'

export interface PackageVersionData {
  latestVersion: string
  allVersions: string[]
}

const inFlightLookups = new Map<string, Promise<PackageVersionData>>()

const registryOrigin = new URL(NPM_REGISTRY_URL).origin
const registryPathPrefix = new URL(NPM_REGISTRY_URL).pathname.replace(/\/$/, '')

// Few connections + many requests per connection = maximum keep-alive reuse.
// No per-request timeouts: correctness matters more than speed for a CLI that
// runs on demand. Slow responses are tolerated; only true errors cause retry.
const registryPool = new Pool(registryOrigin, {
  connections: 6,
  pipelining: 1,
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 600_000,
  headersTimeout: 0,
  bodyTimeout: 0,
  connectTimeout: 15_000,
  allowH2: false,
})

const MAX_REGISTRY_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [500, 1500, 3000]
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

async function attemptRegistryFetch(path: string): Promise<RegistryAttemptOutcome> {
  try {
    const { statusCode, headers, body } = await registryPool.request({
      path,
      method: 'GET',
      headers: {
        accept: 'application/vnd.npm.install-v1+json',
        'accept-encoding': 'gzip, deflate, br',
      },
      headersTimeout: 0,
      bodyTimeout: 0,
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

async function fetchFromRegistryWithRetries(path: string): Promise<RegistryAttemptOutcome> {
  let lastOutcome: RegistryAttemptOutcome = { kind: 'transient' }
  for (let attempt = 0; attempt < MAX_REGISTRY_ATTEMPTS; attempt++) {
    const outcome = await attemptRegistryFetch(path)
    if (outcome.kind === 'success' || outcome.kind === 'not-found') {
      return outcome
    }
    lastOutcome = outcome
    if (attempt < MAX_REGISTRY_ATTEMPTS - 1) {
      const backoff = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]
      await sleep(backoff)
    }
  }
  return lastOutcome
}

async function fetchPackageFromRegistryWithFallback(
  packageName: string,
  currentVersion: string | undefined
): Promise<PackageVersionData> {
  const path = encodeRegistryPath(packageName)
  const outcome = await fetchFromRegistryWithRetries(path)

  if (outcome.kind === 'success') {
    return outcome.data
  }
  if (outcome.kind === 'not-found') {
    return { latestVersion: 'unknown', allVersions: [] }
  }

  // Only reach here after exhausted retries against real errors — try jsdelivr
  // as last-resort safety net so we don't silently return 'unknown'.
  const fallback = await fetchFromJsdelivrFallback(packageName, currentVersion).catch(() => null)
  return fallback ?? { latestVersion: 'unknown', allVersions: [] }
}

/**
 * Fetches package version data from npm registry for multiple packages.
 * Uses an undici Pool with HTTP/1.1 pipelining for high throughput.
 * Only returns valid semantic versions (X.Y.Z format, excluding pre-releases).
 */
export async function getAllPackageData(
  packageNames: string[],
  onProgress?: (currentPackage: string, completed: number, total: number) => void,
  currentVersions?: Map<string, string>,
  onPackageStart?: OnPackageStartCallback
): Promise<Map<string, PackageVersionData>> {
  const packageData = new Map<string, PackageVersionData>()

  if (packageNames.length === 0) {
    return packageData
  }

  const total = packageNames.length
  let completedCount = 0

  await runWithConcurrencyLimit(packageNames, 10, async (packageName) => {
    onPackageStart?.(packageName)
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
  options: RegistryBatchOptions = {},
  onPackageStart?: OnPackageStartCallback
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
        onPackageStart?.(packageName)
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
