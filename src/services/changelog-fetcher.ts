import { NPM_REGISTRY_URL } from '../config/constants'
import { fetchExactPackageManifest } from './jsdelivr-registry'

export interface PackageMetadata {
  description: string
  homepage?: string
  repository?: {
    url?: string
    type?: string
  }
  bugs?: {
    url?: string
  }
  keywords?: string[]
  author?: string
  license?: string
  latestChangelog?: string
  releaseNotes?: string // GitHub releases URL
  weeklyDownloads?: number
  repositoryUrl?: string
  issuesUrl?: string
  npmUrl?: string
}

/**
 * Fetches package metadata from npm registry
 * Includes description, repository info, and basic metadata
 */
export class ChangelogFetcher {
  private cache: Map<string, PackageMetadata> = new Map()
  private failureCache: Set<string> = new Set() // Track packages that failed to fetch
  private inFlight: Map<string, Promise<PackageMetadata | null>> = new Map()

  private getCacheKey(packageName: string, version?: string): string {
    return `${packageName}@${version?.trim() || 'latest'}`
  }

  /**
   * Fetch package metadata from npm registry
   * Uses a cached approach to avoid repeated requests
   */
  async fetchPackageMetadata(packageName: string, version?: string): Promise<PackageMetadata | null> {
    const cacheKey = this.getCacheKey(packageName, version)

    // Check if we already have this in cache
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }

    // Check if we already failed to fetch this
    if (this.failureCache.has(cacheKey)) {
      return null
    }

    const inFlight = this.inFlight.get(cacheKey)
    if (inFlight) {
      return await inFlight
    }

    const lookupPromise = this.fetchAndCachePackageMetadata(packageName, version).finally(() => {
      this.inFlight.delete(cacheKey)
    })
    this.inFlight.set(cacheKey, lookupPromise)
    return await lookupPromise
  }

  private async fetchAndCachePackageMetadata(
    packageName: string,
    version?: string
  ): Promise<PackageMetadata | null> {
    const cacheKey = this.getCacheKey(packageName, version)

    try {
      const response = await this.fetchPackageManifest(packageName, version)

      if (!response) {
        this.failureCache.add(cacheKey)
        return null
      }

      const repository = response.repository as { url?: string; type?: string } | undefined
      const bugs = response.bugs as { url?: string } | undefined
      const keywords = Array.isArray(response.keywords) ? (response.keywords as string[]) : []
      const author =
        typeof response.author === 'object' && response.author !== null
          ? ((response.author as { name?: string }).name ?? response.author)
          : response.author
      const repositoryUrl = this.extractRepositoryUrl(repository?.url || '')
      const npmUrl = `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`
      const issuesUrl = repositoryUrl ? `${repositoryUrl}/issues` : undefined

      const metadata: PackageMetadata = {
        description:
          typeof response.description === 'string' && response.description
            ? response.description
            : 'No description available',
        homepage: typeof response.homepage === 'string' ? response.homepage : undefined,
        repository,
        bugs,
        keywords,
        author: typeof author === 'string' ? author : undefined,
        license: typeof response.license === 'string' ? response.license : undefined,
        repositoryUrl,
        npmUrl,
        issuesUrl,
      }

      // Try to extract release notes/changelog info
      if (repositoryUrl) {
        metadata.releaseNotes = `${repositoryUrl}/releases`
      }

      // Try to get weekly download count
      try {
        const downloadsData = await this.fetchDownloadStats(packageName)
        if (downloadsData) {
          metadata.weeklyDownloads = downloadsData.downloads
        }
      } catch {
        // Ignore download stats errors - optional data
      }

      this.cache.set(cacheKey, metadata)
      return metadata
    } catch {
      // Cache the failure to avoid retrying
      this.failureCache.add(cacheKey)
      return null
    }
  }

  /**
   * Fetch metadata from a lightweight manifest endpoint.
   */
  private async fetchPackageManifest(
    packageName: string,
    version?: string
  ): Promise<Record<string, unknown> | null> {
    try {
      const normalizedVersion = version?.trim()
      if (normalizedVersion) {
        const jsdelivrManifest = await fetchExactPackageManifest(packageName, normalizedVersion)
        if (jsdelivrManifest) {
          return jsdelivrManifest
        }
      }

      const npmPath = normalizedVersion ? normalizedVersion : 'latest'
      const response = await fetch(
        `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}/${encodeURIComponent(npmPath)}`,
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
          },
        }
      )

      if (!response.ok) {
        return null
      }

      return (await response.json()) as Record<string, unknown>
    } catch {
      return null
    }
  }

  /**
   * Extract GitHub URL from repository URL for easier access to releases
   */
  private extractRepositoryUrl(repoUrl: string): string {
    if (!repoUrl) return ''

    // Handle various repository URL formats
    // git+https://github.com/user/repo.git -> https://github.com/user/repo/releases
    // https://github.com/user/repo.git -> https://github.com/user/repo/releases
    // github:user/repo -> https://github.com/user/repo/releases

    let cleanUrl = repoUrl
      .replace(/^git\+/, '') // Remove git+ prefix
      .replace(/\.git$/, '') // Remove .git suffix
      .replace(/^github:/, 'https://github.com/') // Convert github: format

    // Ensure it's a proper URL
    if (!cleanUrl.startsWith('http')) {
      cleanUrl = 'https://github.com/' + cleanUrl
    }

    return cleanUrl
  }

  /**
   * Fetch weekly download statistics from npm
   */
  private async fetchDownloadStats(packageName: string): Promise<{ downloads: number } | null> {
    try {
      const response = await fetch(
        `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}`,
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
          },
        }
      )

      if (!response.ok) {
        return null
      }

      const data = (await response.json()) as Record<string, unknown>
      return {
        downloads: (data.downloads as number) || 0,
      }
    } catch {
      return null
    }
  }

  /**
   * Get repository release URL for a package
   */
  getRepositoryReleaseUrl(packageName: string, version: string): string | null {
    const metadata =
      this.cache.get(this.getCacheKey(packageName, version)) ??
      this.cache.get(this.getCacheKey(packageName)) ??
      this.cache.get(packageName)
    if (!metadata || !metadata.releaseNotes) {
      return null
    }
    return `${metadata.releaseNotes}/releases/tag/v${version}`
  }

  /**
   * Cache package metadata directly (used by utils to avoid duplicate fetches)
   */
  cacheMetadata(
    packageName: string,
    rawData: {
      description?: string
      homepage?: string
      repository?: any
      bugs?: any
      keywords?: string[]
      author?: any
      license?: string
    }
  ): void {
    const repositoryUrl = this.extractRepositoryUrl(rawData.repository?.url || '')
    const npmUrl = `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`
    const issuesUrl = repositoryUrl ? `${repositoryUrl}/issues` : undefined

    const metadata: PackageMetadata = {
      description: rawData.description || 'No description available',
      homepage: rawData.homepage,
      repository: rawData.repository,
      bugs: rawData.bugs,
      keywords: rawData.keywords || [],
      author: rawData.author?.name || rawData.author,
      license: rawData.license,
      repositoryUrl,
      npmUrl,
      issuesUrl,
    }

    if (repositoryUrl) {
      metadata.releaseNotes = `${repositoryUrl}/releases`
    }

    this.cache.set(packageName, metadata)
  }

  /**
   * Clear the cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear()
    this.failureCache.clear()
    this.inFlight.clear()
  }
}

export const changelogFetcher = new ChangelogFetcher()
