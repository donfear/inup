import { Pool } from 'undici'
import { gunzip, inflate, brotliDecompress } from 'node:zlib'
import { promisify } from 'node:util'

const gunzipAsync = promisify(gunzip)
const inflateAsync = promisify(inflate)
const brotliDecompressAsync = promisify(brotliDecompress)
import { NPM_REGISTRY_URL } from '../config'
import { parseVersions } from '../utils/version'
import { sleep, isRetryableStatus, isTransientNetworkError } from './http/retry'
import { InflightMap } from './http/inflight'
import {
  FetchPackageVersionsOptions,
  OnBatchReadyCallback,
  RegistryBatchProgressItem,
} from '../types'

export interface PackageVersionData {
  latestVersion: string
  allVersions: string[]
  deprecated?: string // npm deprecation message for the latest version, if any
  enginesNode?: string // declared engines.node range for the latest version, if any
}

const inFlightLookups = new InflightMap<PackageVersionData>()

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

async function getFreshPackageData(
  packageName: string,
  currentVersion: string | undefined
): Promise<PackageVersionData> {
  const cacheKey = `${packageName}@${currentVersion ?? ''}`
  return inFlightLookups.dedupe(cacheKey, () => fetchPackageFromRegistry(packageName))
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

async function fetchPackageFromRegistry(packageName: string): Promise<PackageVersionData> {
  const path = encodeRegistryPath(packageName)
  const outcome = await fetchFromRegistryWithRetries(path)

  if (outcome.kind === 'success') {
    return outcome.data
  }

  // Not found, or exhausted retries against real errors: report unavailable.
  // The registry is the single source of truth — there is no secondary fetch.
  return { latestVersion: 'unknown', allVersions: [] }
}

/**
 * Fetches version data for a list of packages from the npm registry.
 *
 * Concurrency model:
 * - `maxConcurrency` is a global cap on in-flight fetches at any moment.
 *   It doesn't interact with batch size — batches exist only to group
 *   emissions for the UI.
 * - No per-request timeouts: slow responses are allowed to finish. Real
 *   network errors are retried with exponential backoff; after the retry
 *   budget is exhausted the package is reported as unavailable
 *   (`latestVersion: 'unknown'`). A result is never silently dropped due to
 *   slowness.
 *
 * Callbacks:
 * - `onBatchReady` fires once a whole emission batch has resolved, in
 *   original batch order.
 */
export async function fetchPackageVersions(
  packageNames: string[],
  options: {
    onBatchReady?: OnBatchReadyCallback
    currentVersions?: Map<string, string>
  } & FetchPackageVersionsOptions = {}
): Promise<Map<string, PackageVersionData>> {
  const packageData = new Map<string, PackageVersionData>()

  if (packageNames.length === 0) {
    return packageData
  }

  const batchSizes =
    options.batchSizes && options.batchSizes.length > 0
      ? options.batchSizes.map((size: number) => Math.max(1, size))
      : [Math.max(1, options.batchSize ?? 25)]
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? 10)
  const total = packageNames.length
  let completedCount = 0

  const pendingEmissions = new Map<number, RegistryBatchProgressItem[]>()
  let nextEmitIndex = 0
  const flushPending = () => {
    while (pendingEmissions.has(nextEmitIndex)) {
      const ready = pendingEmissions.get(nextEmitIndex)!
      pendingEmissions.delete(nextEmitIndex)
      options.onBatchReady?.(ready)
      nextEmitIndex++
    }
  }

  // Global semaphore: `maxConcurrency` is the total in-flight cap across
  // all batches. Batches don't gate concurrency — only emission order.
  let inFlight = 0
  const waiters: Array<() => void> = []
  const acquire = async (): Promise<void> => {
    if (inFlight < maxConcurrency) {
      inFlight++
      return
    }
    await new Promise<void>((resolve) => waiters.push(resolve))
    inFlight++
  }
  const release = () => {
    inFlight--
    const next = waiters.shift()
    if (next) next()
  }

  const batchPromises: Promise<void>[] = []
  let batchStart = 0
  let batchIndex = 0

  while (batchStart < packageNames.length) {
    const batchSize = batchSizes[Math.min(batchIndex, batchSizes.length - 1)]
    const batchNames = packageNames.slice(batchStart, batchStart + batchSize)
    const capturedBatchIndex = batchIndex
    const batchResults: RegistryBatchProgressItem[] = new Array(batchNames.length)

    const batchPromise = Promise.all(
      batchNames.map(async (packageName, itemIndex) => {
        await acquire()
        try {
          const data = await getFreshPackageData(
            packageName,
            options.currentVersions?.get(packageName)
          )
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
        } finally {
          release()
        }
      })
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
