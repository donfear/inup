import { NpmRegistryClient } from '../clients/npm-registry-client'
import { extractRepositoryUrl } from '../parsers/repository-ref'
import { PackageManifestInput, PackageMetadata } from '../types/changelog.types'
import { fetchExactPackageManifest } from '../../../services/jsdelivr-registry'

export class PackageMetadataService {
  private cache = new Map<string, PackageMetadata>()
  private failureCache = new Set<string>()
  private inFlight = new Map<string, Promise<PackageMetadata | null>>()

  constructor(
    private readonly npmRegistryClient = new NpmRegistryClient(),
    private readonly exactManifestFetcher = fetchExactPackageManifest
  ) {}

  clearCache(): void {
    this.cache.clear()
    this.failureCache.clear()
    this.inFlight.clear()
  }

  getCached(packageName: string, version?: string): PackageMetadata | null {
    return (
      this.cache.get(this.getCacheKey(packageName, version)) ??
      this.cache.get(this.getCacheKey(packageName)) ??
      this.cache.get(packageName) ??
      null
    )
  }

  async fetchPackageMetadata(
    packageName: string,
    version?: string,
    signal?: AbortSignal
  ): Promise<PackageMetadata | null> {
    const cacheKey = this.getCacheKey(packageName, version)

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }

    if (this.failureCache.has(cacheKey)) {
      return null
    }

    const inFlight = this.inFlight.get(cacheKey)
    if (inFlight) {
      return await inFlight
    }

    const lookupPromise = this.fetchAndCachePackageMetadata(packageName, version, signal).finally(
      () => {
        this.inFlight.delete(cacheKey)
      }
    )

    this.inFlight.set(cacheKey, lookupPromise)
    return await lookupPromise
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
        this.failureCache.add(cacheKey)
        return null
      }

      const metadata = this.buildMetadata(packageName, manifest)

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

      this.failureCache.add(cacheKey)
      return null
    }
  }

  private async fetchPackageManifest(
    packageName: string,
    version?: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown> | null> {
    signal?.throwIfAborted()

    const normalizedVersion = version?.trim()
    if (normalizedVersion) {
      const jsdelivrManifest = await this.exactManifestFetcher(packageName, normalizedVersion)
      if (jsdelivrManifest) {
        return jsdelivrManifest
      }
    }

    signal?.throwIfAborted()

    return await this.npmRegistryClient.fetchPackageManifest(
      packageName,
      normalizedVersion || 'latest',
      signal
    )
  }

  private buildMetadata(packageName: string, rawData: PackageManifestInput): PackageMetadata {
    const repository = rawData.repository as { url?: string; type?: string } | undefined
    const bugs = rawData.bugs as { url?: string } | undefined
    const keywords = Array.isArray(rawData.keywords) ? (rawData.keywords as string[]) : []
    const author =
      typeof rawData.author === 'object' && rawData.author !== null
        ? ((rawData.author as { name?: string }).name ?? rawData.author)
        : rawData.author
    const repositoryUrl = extractRepositoryUrl(repository?.url || '')
    const npmUrl = `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`
    const issuesUrl = repositoryUrl ? `${repositoryUrl}/issues` : undefined

    const metadata: PackageMetadata = {
      description:
        typeof rawData.description === 'string' && rawData.description
          ? rawData.description
          : 'No description available',
      homepage: typeof rawData.homepage === 'string' ? rawData.homepage : undefined,
      repository,
      bugs,
      keywords,
      author: typeof author === 'string' ? author : undefined,
      license: typeof rawData.license === 'string' ? rawData.license : undefined,
      repositoryUrl,
      npmUrl,
      issuesUrl,
    }

    if (repositoryUrl) {
      metadata.releaseNotes = `${repositoryUrl}/releases`
    }

    return metadata
  }
}
