import * as semver from 'semver'
import { NPM_REGISTRY_URL, JSDELIVR_CDN_URL } from '../config/constants'
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
  private releaseNotesCache: Map<string, string | null> = new Map()
  private releaseNotesInFlight: Map<string, Promise<string | null>> = new Map()
  private rawChangelogCache: Map<string, string | null> = new Map()

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

  /**
   * Fetch package metadata from npm registry
   * Uses a cached approach to avoid repeated requests
   */
  async fetchPackageMetadata(
    packageName: string,
    version?: string
  ): Promise<PackageMetadata | null> {
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

      this.cachePackageMetadata(packageName, cacheKey, metadata)
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
    return `${metadata.releaseNotes}/tag/v${version}`
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
   * Get versions between fromVersion (exclusive) and toVersion (inclusive),
   * sorted newest-first. Used to build the lazy-load list for release notes.
   */
  getVersionsBetween(
    allVersions: string[],
    fromVersion: string,
    toVersion: string
  ): string[] {
    const cleanFrom = semver.clean(fromVersion)
    const cleanTo = semver.clean(toVersion)
    if (!cleanFrom || !cleanTo) return []

    return allVersions
      .filter((v) => {
        const cleaned = semver.clean(v)
        if (!cleaned) return false
        return semver.gt(cleaned, cleanFrom) && semver.lte(cleaned, cleanTo)
      })
      .sort(semver.rcompare)
  }

  /**
   * Fetch release notes content for a specific package version.
   * Tries GitHub Releases API first, then CHANGELOG.md from jsDelivr.
   * Returns the markdown text or null if unavailable.
   */
  async fetchReleaseNotesForVersion(
    packageName: string,
    version: string
  ): Promise<string | null> {
    const notesCacheKey = `release-notes:${packageName}@${version}`

    // Check cache
    if (this.releaseNotesCache.has(notesCacheKey)) {
      return this.releaseNotesCache.get(notesCacheKey)!
    }

    // Check in-flight
    const inFlight = this.releaseNotesInFlight.get(notesCacheKey)
    if (inFlight) {
      return await inFlight
    }

    const promise = this.doFetchReleaseNotes(packageName, version).then((result) => {
      this.releaseNotesCache.set(notesCacheKey, result)
      this.releaseNotesInFlight.delete(notesCacheKey)
      return result
    })
    this.releaseNotesInFlight.set(notesCacheKey, promise)
    return await promise
  }

  private async doFetchReleaseNotes(
    packageName: string,
    version: string
  ): Promise<string | null> {
    // Get the repository URL for GitHub API
    const metadata =
      this.cache.get(this.getCacheKey(packageName, version)) ??
      this.cache.get(this.getCacheKey(packageName)) ??
      this.cache.get(packageName)

    const repoUrl = metadata?.repositoryUrl || ''

    // Try GitHub Releases API if we have a GitHub repo
    if (repoUrl.includes('github.com')) {
      const ghNotes = await this.fetchGitHubReleaseNotes(repoUrl, version)
      if (ghNotes) return ghNotes

      // Fallback: try CHANGELOG.md from the GitHub repo (raw)
      const rawChangelog = await this.fetchGitHubChangelogMd(repoUrl, version)
      if (rawChangelog) return rawChangelog
    }

    // Fallback: try CHANGELOG.md from jsDelivr (npm package)
    const changelogNotes = await this.fetchChangelogMd(packageName, version)
    if (changelogNotes) return changelogNotes

    return null
  }

  private async fetchGitHubReleaseNotes(
    repoUrl: string,
    version: string
  ): Promise<string | null> {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) return null

    const [, owner, repo] = match

    // Try v-prefixed tag first, then plain version
    for (const tag of [`v${version}`, version]) {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
          {
            method: 'GET',
            headers: {
              accept: 'application/vnd.github.v3+json',
              'user-agent': 'inup-cli',
            },
            signal: AbortSignal.timeout(10000),
          }
        )

        if (!response.ok) continue

        const data = (await response.json()) as { body?: string; name?: string }
        if (data.body && data.body.trim().length > 0) {
          return data.body.trim()
        }
      } catch {
        // Continue to next tag format or fallback
      }
    }

    return null
  }

  /**
   * Fetch CHANGELOG.md from a GitHub repo's default branch and extract the
   * section for the requested version. Caches the full file per-repo.
   */
  private async fetchGitHubChangelogMd(
    repoUrl: string,
    version: string
  ): Promise<string | null> {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) return null

    const [, owner, repo] = match
    const cacheKey = `changelog-raw:${owner}/${repo}`

    let fullText = this.rawChangelogCache.get(cacheKey)
    if (fullText === undefined) {
      fullText = await this.downloadGitHubChangelog(owner, repo)
      this.rawChangelogCache.set(cacheKey, fullText)
    }

    if (!fullText) return null
    return this.extractVersionSection(fullText, version)
  }

  private async downloadGitHubChangelog(
    owner: string,
    repo: string
  ): Promise<string | null> {
    // Try common branch names and file names
    const branches = ['main', 'master']
    const filenames = ['CHANGELOG.md', 'CHANGES.md', 'HISTORY.md']

    for (const branch of branches) {
      for (const filename of filenames) {
        try {
          const response = await fetch(
            `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filename}`,
            {
              method: 'GET',
              signal: AbortSignal.timeout(10000),
            }
          )
          if (response.ok) {
            return await response.text()
          }
        } catch {
          // Continue to next combination
        }
      }
    }

    return null
  }

  private async fetchChangelogMd(
    packageName: string,
    version: string
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `${JSDELIVR_CDN_URL}/${encodeURIComponent(packageName)}@${version}/CHANGELOG.md`,
        {
          method: 'GET',
          signal: AbortSignal.timeout(10000),
        }
      )

      if (!response.ok) return null

      const fullText = await response.text()
      return this.extractVersionSection(fullText, version)
    } catch {
      return null
    }
  }

  /**
   * Extract the section for a specific version from a CHANGELOG.md file.
   * Matches headers like: ## 1.2.3, ## [1.2.3], ## v1.2.3
   */
  private extractVersionSection(changelog: string, version: string): string | null {
    const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Match ## v1.2.3, ## [v1.2.3], ## 1.2.3, ## [1.2.3] (with optional date/text after)
    const sectionRegex = new RegExp(
      `^##\\s+\\[?v?${escapedVersion}\\]?[^\\n]*\\n`,
      'm'
    )

    const match = sectionRegex.exec(changelog)
    if (!match) return null

    const startIndex = match.index + match[0].length
    // Find the next ## header (next version section)
    const nextSectionMatch = /^## /m.exec(changelog.slice(startIndex))
    const endIndex = nextSectionMatch
      ? startIndex + nextSectionMatch.index
      : changelog.length

    const section = changelog.slice(startIndex, endIndex).trim()
    if (section.length === 0) return null

    // Limit to reasonable length (~100 lines)
    const lines = section.split('\n')
    if (lines.length > 100) {
      return lines.slice(0, 100).join('\n') + '\n...'
    }
    return section
  }

  /**
   * Clear the cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear()
    this.failureCache.clear()
    this.inFlight.clear()
    this.releaseNotesCache.clear()
    this.releaseNotesInFlight.clear()
    this.rawChangelogCache.clear()
  }
}

export const changelogFetcher = new ChangelogFetcher()
