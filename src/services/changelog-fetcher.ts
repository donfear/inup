import chalk from 'chalk'
import { JSDELIVR_CDN_URL } from '../config/constants'

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

  /**
   * Fetch package metadata from npm registry
   * Uses a cached approach to avoid repeated requests
   */
  async fetchPackageMetadata(packageName: string): Promise<PackageMetadata | null> {
    // Check if we already have this in cache
    if (this.cache.has(packageName)) {
      return this.cache.get(packageName)!
    }

    // Check if we already failed to fetch this
    if (this.failureCache.has(packageName)) {
      return null
    }

    try {
      // Fetch from npm registry
      const response = await this.fetchFromRegistry(packageName)

      if (!response) {
        this.failureCache.add(packageName)
        return null
      }

      const repositoryUrl = this.extractRepositoryUrl(response.repository?.url || '')
      const npmUrl = `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`
      const issuesUrl = repositoryUrl ? `${repositoryUrl}/issues` : undefined

      const metadata: PackageMetadata = {
        description: response.description || 'No description available',
        homepage: response.homepage,
        repository: response.repository,
        bugs: response.bugs,
        keywords: response.keywords || [],
        author: response.author?.name || response.author,
        license: response.license,
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

      this.cache.set(packageName, metadata)
      return metadata
    } catch (error) {
      // Cache the failure to avoid retrying
      this.failureCache.add(packageName)
      return null
    }
  }

  /**
   * Fetch data from jsdelivr CDN
   * Returns the package data by fetching package.json directly from jsdelivr
   */
  private async fetchFromRegistry(packageName: string): Promise<any> {
    try {
      // Fetch package.json directly from jsdelivr CDN (resolves to latest automatically)
      const response = await fetch(
        `${JSDELIVR_CDN_URL}/${encodeURIComponent(packageName)}@latest/package.json`,
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

      const pkgData = (await response.json()) as Record<string, unknown>

      return {
        description: pkgData.description,
        homepage: pkgData.homepage as string | undefined,
        repository: pkgData.repository as any,
        bugs: pkgData.bugs as any,
        keywords: (pkgData.keywords || []) as string[],
        author: pkgData.author as any,
        license: pkgData.license as string | undefined,
      }
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
    const metadata = this.cache.get(packageName)
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
  }
}

export const changelogFetcher = new ChangelogFetcher()
