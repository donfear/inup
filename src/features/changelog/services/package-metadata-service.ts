import { NpmRegistryClient } from '../clients/npm-registry-client'
import { mapPackageManifestToMetadata } from '../parsers/package-metadata'
import { PackageManifestInput, PackageMetadata } from '../types/changelog.types'
import { InflightMap } from '../../../shared/http/inflight'

export class PackageMetadataService {
  private cache = new Map<string, PackageMetadata | null>()
  private inFlight = new InflightMap<PackageMetadata | null>()

  constructor(private readonly npmRegistryClient = new NpmRegistryClient()) {}

  clearCache(): void {
    this.cache.clear()
    this.inFlight.clear()
  }

  getCached(packageName: string, version?: string): PackageMetadata | null {
    for (const key of [
      this.getCacheKey(packageName, version),
      this.getCacheKey(packageName),
      packageName,
    ]) {
      if (this.cache.has(key)) {
        return this.cache.get(key) ?? null
      }
    }

    return null
  }

  async fetchPackageMetadata(
    packageName: string,
    version?: string,
    signal?: AbortSignal
  ): Promise<PackageMetadata | null> {
    const cacheKey = this.getCacheKey(packageName, version)

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) ?? null
    }

    return this.inFlight.dedupe(cacheKey, () =>
      this.fetchAndCachePackageMetadata(packageName, version, signal)
    )
  }

  cacheMetadata(packageName: string, rawData: PackageManifestInput): void {
    const metadata = this.buildMetadata(packageName, rawData)
    this.cache.set(packageName, metadata)
  }

  getRepositoryReleaseUrl(packageName: string, version: string): string | null {
    const metadata = this.getCached(packageName, version)
    if (!metadata?.releaseNotes) {
      return null
    }

    return `${metadata.releaseNotes}/tag/v${version}`
  }

  private getCacheKey(packageName: string, version?: string): string {
    return `${packageName}@${version?.trim() || 'latest'}`
  }

  private cachePackageMetadata(
    packageName: string,
    cacheKey: string,
    metadata: PackageMetadata
  ): void {
    this.cache.set(cacheKey, metadata)
    this.cache.set(this.getCacheKey(packageName), metadata)
    this.cache.set(packageName, metadata)
  }

  private async fetchAndCachePackageMetadata(
    packageName: string,
    version?: string,
    signal?: AbortSignal
  ): Promise<PackageMetadata | null> {
    const cacheKey = this.getCacheKey(packageName, version)

    try {
      signal?.throwIfAborted()

      const manifest = await this.fetchPackageManifest(packageName, version, signal)
      if (!manifest) {
        this.cache.set(cacheKey, null)
        return null
      }

      const metadata = mapPackageManifestToMetadata(packageName, manifest)

      try {
        signal?.throwIfAborted()
        const downloadsData = await this.npmRegistryClient.fetchDownloadStats(packageName, signal)
        if (downloadsData) {
          metadata.weeklyDownloads = downloadsData.downloads
        }
      } catch {
        // Optional data should not fail metadata hydration.
      }

      this.cachePackageMetadata(packageName, cacheKey, metadata)
      return metadata
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }

      this.cache.set(cacheKey, null)
      return null
    }
  }

  private async fetchPackageManifest(
    packageName: string,
    version?: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown> | null> {
    signal?.throwIfAborted()

    return await this.npmRegistryClient.fetchPackageManifest(
      packageName,
      version?.trim() || 'latest',
      signal
    )
  }

  private buildMetadata(packageName: string, rawData: PackageManifestInput): PackageMetadata {
    return mapPackageManifestToMetadata(packageName, rawData)
  }
}
