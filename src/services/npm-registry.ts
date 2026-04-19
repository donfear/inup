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

const registryPool = new Pool(registryOrigin, {
  connections: 64,
  pipelining: 10,
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 600_000,
  headersTimeout: REQUEST_TIMEOUT,
  bodyTimeout: REQUEST_TIMEOUT,
  allowH2: false,
})

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

async function fetchPackageFromRegistryWithFallback(
  packageName: string,
  currentVersion: string | undefined
): Promise<PackageVersionData> {
  try {
    const encodedName = packageName.startsWith('@')
      ? `@${encodeURIComponent(packageName.slice(1).split('/')[0])}/${encodeURIComponent(
          packageName.slice(packageName.indexOf('/') + 1)
        )}`
      : encodeURIComponent(packageName)
    const path = `${registryPathPrefix}/${encodedName}`

    const { statusCode, headers, body } = await registryPool.request({
      path,
      method: 'GET',
      headers: {
        accept: 'application/vnd.npm.install-v1+json',
        'accept-encoding': 'gzip, deflate, br',
      },
      headersTimeout: REQUEST_TIMEOUT,
      bodyTimeout: REQUEST_TIMEOUT,
      blocking: false,
    })

    if (statusCode < 200 || statusCode >= 300) {
      await body.dump()
      if (isRetryableStatus(statusCode)) {
        return await fetchFromJsdelivrFallback(packageName, currentVersion)
      }
      return { latestVersion: 'unknown', allVersions: [] }
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
    return parseVersions(decoded.toString('utf8'))
  } catch (error) {
    if (isTransientNetworkError(error)) {
      return await fetchFromJsdelivrFallback(packageName, currentVersion)
    }
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

  const allPromises = packageNames.map(async (packageName) => {
    const data = await getFreshPackageData(packageName, currentVersions?.get(packageName))
    packageData.set(packageName, data)

    completedCount++

    if (onProgress) {
      onProgress(packageName, completedCount, total)
    }
  })

  await Promise.all(allPromises)

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
