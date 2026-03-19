import * as semver from 'semver'
import { NPM_REGISTRY_URL, REQUEST_TIMEOUT } from '../config'
import { getAllPackageDataFromJsdelivr } from './jsdelivr-registry'
import { ConsoleUtils } from '../ui/utils'
import { OnBatchReadyCallback, RegistryBatchOptions, RegistryBatchProgressItem } from '../types'

export interface PackageVersionData {
  latestVersion: string
  allVersions: string[]
}

const inFlightLookups = new Map<string, Promise<PackageVersionData>>()

const isRetryableStatus = (statusCode: number): boolean =>
  statusCode === 408 || statusCode === 429 || statusCode >= 500

const isTransientNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }

  const maybeCode = (error as Error & { code?: string }).code
  return (
    error.name === 'AbortError' ||
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

/**
 * Fetches package data from npm registry.
 * Falls back to jsDelivr when npm is temporarily unavailable.
 */
async function fetchPackageFromRegistryWithFallback(
  packageName: string,
  currentVersion: string | undefined
): Promise<PackageVersionData> {
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
        if (isRetryableStatus(response.status)) {
          return await fetchFromJsdelivrFallback(packageName, currentVersion)
        }
        throw new Error(`HTTP ${response.status}`)
      }

      const text = await response.text()
      const data = JSON.parse(text) as {
        versions?: Record<string, unknown>
      }

      const allVersions = Object.keys(data.versions || {}).filter((version) =>
        /^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)
      )

      const sortedVersions = allVersions.sort(semver.rcompare)
      const latestVersion = sortedVersions.length > 0 ? sortedVersions[0] : 'unknown'

      return {
        latestVersion,
        allVersions,
      }
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    if (isTransientNetworkError(error)) {
      return await fetchFromJsdelivrFallback(packageName, currentVersion)
    }
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

  // Wait for all requests to complete
  await Promise.all(allPromises)

  // Clear the progress line if no custom progress handler
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

  while (batchStart < packageNames.length) {
    const batchSize = batchSizes[Math.min(batchIndex, batchSizes.length - 1)]
    const batchNames = packageNames.slice(batchStart, batchStart + batchSize)
    const batchResults: RegistryBatchProgressItem[] = new Array(batchNames.length)

    await runWithConcurrencyLimit(batchNames, concurrency, async (packageName, itemIndex) => {
      const data = await getFreshPackageData(packageName, currentVersions?.get(packageName))
      packageData.set(packageName, data)
      completedCount++
      batchResults[itemIndex] = {
        packageName,
        data,
        completed: completedCount,
        total,
        batchIndex,
        itemIndex,
      }
    })

    onBatchReady?.(batchResults.filter(Boolean))

    batchStart += batchSize
    batchIndex++
  }

  return packageData
}

/**
 * Retained for backward compatibility. Registry responses are fresh-by-default.
 */
export function clearPackageCache(): void {
  inFlightLookups.clear()
}
