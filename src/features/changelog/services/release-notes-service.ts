import * as semver from 'semver'
import { GitHubClient } from '../clients/github-client'
import { extractVersionSection, normalizeReleaseTag } from '../parsers/changelog-parser'
import { extractReleaseNotesFromHtml } from '../parsers/github-release-html-parser'
import { PackageMetadataService } from './package-metadata-service'

const RELEASE_NOTES_FETCH_TIMEOUT_MS = 5000
const PREFER_GITHUB_RELEASE_PAGE = true

export class ReleaseNotesService {
  private releaseNotesCache = new Map<string, string | null>()
  private releaseNotesInFlight = new Map<string, Promise<string | null>>()

  constructor(
    private readonly metadataService: PackageMetadataService,
    private readonly githubClient = new GitHubClient()
  ) {}

  clearCache(): void {
    this.releaseNotesCache.clear()
    this.releaseNotesInFlight.clear()
    this.githubClient.clearCache()
  }

  async fetchReleaseNotesForVersion(
    packageName: string,
    version: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const cacheKey = `release-notes:${packageName}@${version}`

    if (this.releaseNotesCache.has(cacheKey)) {
      return this.releaseNotesCache.get(cacheKey)!
    }

    const inFlight = this.releaseNotesInFlight.get(cacheKey)
    if (inFlight) {
      return await inFlight
    }

    const promise = this.doFetchReleaseNotes(packageName, version, signal)
      .then((result) => {
        this.releaseNotesCache.set(cacheKey, result)
        return result
      })
      .finally(() => {
        this.releaseNotesInFlight.delete(cacheKey)
      })

    this.releaseNotesInFlight.set(cacheKey, promise)
    return await promise
  }

  private async doFetchReleaseNotes(
    packageName: string,
    version: string,
    callerSignal?: AbortSignal
  ): Promise<string | null> {
    const timeoutSignal = AbortSignal.timeout(RELEASE_NOTES_FETCH_TIMEOUT_MS)
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal

    signal.throwIfAborted()

    const metadata =
      this.metadataService.getCached(packageName, version) ??
      (await this.metadataService.fetchPackageMetadata(packageName, version, signal))
    const repoUrl = metadata?.repositoryUrl || ''

    if (repoUrl.includes('github.com')) {
      for (const loadSource of this.getGitHubSources(repoUrl, version, signal)) {
        const notes = await loadSource()
        if (notes) return notes
      }
    }

    return null
  }

  private getGitHubSources(
    repoUrl: string,
    version: string,
    signal: AbortSignal
  ): Array<() => Promise<string | null>> {
    const directReleaseSources = PREFER_GITHUB_RELEASE_PAGE
      ? [
          () => this.fetchGitHubReleasePageNotes(repoUrl, version, signal),
          () => this.fetchGitHubReleaseNotes(repoUrl, version, signal),
        ]
      : [
          () => this.fetchGitHubReleaseNotes(repoUrl, version, signal),
          () => this.fetchGitHubReleasePageNotes(repoUrl, version, signal),
        ]

    return [
      ...directReleaseSources,
      () => this.fetchGitHubReleaseListNotes(repoUrl, version, signal),
      () => this.fetchGitHubChangelogMd(repoUrl, version, signal),
    ]
  }

  private async fetchGitHubReleasePageNotes(
    repoUrl: string,
    version: string,
    signal: AbortSignal
  ): Promise<string | null> {
    for (const tag of [`v${version}`, version]) {
      const html = await this.githubClient.fetchReleasePageHtml(repoUrl, tag, signal)
      if (!html) continue

      const extracted = extractReleaseNotesFromHtml(html)
      if (extracted) return extracted
    }

    return null
  }

  private async fetchGitHubReleaseNotes(
    repoUrl: string,
    version: string,
    signal: AbortSignal
  ): Promise<string | null> {
    for (const tag of [`v${version}`, version]) {
      const notes = await this.githubClient.fetchReleaseByTag(repoUrl, tag, signal)
      if (notes) return notes
    }

    return null
  }

  private async fetchGitHubReleaseListNotes(
    repoUrl: string,
    version: string,
    signal: AbortSignal
  ): Promise<string | null> {
    const releases = await this.githubClient.fetchReleases(repoUrl, signal)
    if (!releases) return null

    const normalizedVersion = semver.clean(version)
    if (!normalizedVersion) return null

    for (const release of releases) {
      if (release.draft) continue

      const releaseVersion = normalizeReleaseTag(release.tag_name)
      if (releaseVersion !== normalizedVersion) continue

      if (release.body?.trim()) {
        return release.body.trim()
      }
    }

    return null
  }

  private async fetchGitHubChangelogMd(
    repoUrl: string,
    version: string,
    signal: AbortSignal
  ): Promise<string | null> {
    const fullText = await this.githubClient.fetchRawChangelog(repoUrl, signal)
    if (!fullText) return null

    return extractVersionSection(fullText, version)
  }
}
