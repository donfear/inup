import * as semver from 'semver'
import type { PackageVersionData } from '../npm-registry'
import { debugLog } from '../../utils'
import { extractMajorVersion, toComparableVersion, versionIdentity } from '../../utils/version'
import { InflightMap } from '../http/inflight'
import { fetchPackageManifestFromJsdelivr, fetchPackageManifestFromNpmRegistry } from './client'

const EXACT_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

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

const inFlightManifests = new InflightMap<Record<string, unknown> | null>()

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
  return inFlightManifests.dedupe(cacheKey, async () => {
    const jsdelivrManifest = await fetchPackageManifestFromJsdelivr(packageName, normalizedVersion)
    if (jsdelivrManifest) {
      return jsdelivrManifest
    }
    return await fetchPackageManifestFromNpmRegistry(packageName, normalizedVersion)
  })
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
  const inFlightLookups = new InflightMap<PackageVersionData | null>()

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

    return { latestVersion, allVersions }
  }

  const getPackageData = (
    packageName: string,
    currentVersion: string | undefined
  ): Promise<PackageVersionData | null> =>
    inFlightLookups.dedupe(packageName, () => fetchPackageData(packageName, currentVersion))

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

export async function closeJsdelivrPool(): Promise<void> {
  const { jsdelivrPool } = await import('./client')
  await jsdelivrPool.close()
}

export function clearExactManifestCache(): void {
  inFlightManifests.clear()
}
