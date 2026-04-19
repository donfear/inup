import { GitHubRelease } from '../types/changelog.types'
import { parseGitHubRepo } from '../parsers/repository-ref'

const GITHUB_RELEASES_PAGE_LIMIT = 3

export class GitHubClient {
  private releasesCache = new Map<string, GitHubRelease[] | null>()
  private rawChangelogCache = new Map<string, string | null>()

  clearCache(): void {
    this.releasesCache.clear()
    this.rawChangelogCache.clear()
  }

  async fetchReleaseByTag(
    repoUrl: string,
    tag: string,
    signal: AbortSignal
  ): Promise<string | null> {
    const repo = parseGitHubRepo(repoUrl)
    if (!repo) return null

    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/tags/${tag}`,
        {
          method: 'GET',
          headers: {
            accept: 'application/vnd.github.v3+json',
            'user-agent': 'inup-cli',
          },
          signal,
        }
      )

      if (!response.ok) return null

      const data = (await response.json()) as { body?: string }
      return data.body?.trim() ? data.body.trim() : null
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }

      return null
    }
  }

  async fetchReleasePageHtml(
    repoUrl: string,
    tag: string,
    signal: AbortSignal
  ): Promise<string | null> {
    const repo = parseGitHubRepo(repoUrl)
    if (!repo) return null

    try {
      const response = await fetch(
        `https://github.com/${repo.owner}/${repo.repo}/releases/tag/${tag}`,
        {
          method: 'GET',
          signal,
        }
      )

      if (!response.ok) return null

      return await response.text()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }

      return null
    }
  }

  async fetchReleases(repoUrl: string, signal: AbortSignal): Promise<GitHubRelease[] | null> {
    const repo = parseGitHubRepo(repoUrl)
    if (!repo) return null

    const cacheKey = `${repo.owner}/${repo.repo}`
    if (this.releasesCache.has(cacheKey)) {
      return this.releasesCache.get(cacheKey)!
    }

    const releases: GitHubRelease[] = []

    for (let page = 1; page <= GITHUB_RELEASES_PAGE_LIMIT; page += 1) {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases?per_page=100&page=${page}`,
          {
            method: 'GET',
            headers: {
              accept: 'application/vnd.github.v3+json',
              'user-agent': 'inup-cli',
            },
            signal,
          }
        )

        if (!response.ok) break

        const pageReleases = (await response.json()) as GitHubRelease[]
        if (!Array.isArray(pageReleases) || pageReleases.length === 0) break

        releases.push(...pageReleases)

        if (pageReleases.length < 100) break
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error
        }

        break
      }
    }

    const result = releases.length > 0 ? releases : null
    this.releasesCache.set(cacheKey, result)
    return result
  }

  async fetchRawChangelog(repoUrl: string, signal: AbortSignal): Promise<string | null> {
    const repo = parseGitHubRepo(repoUrl)
    if (!repo) return null

    const cacheKey = `${repo.owner}/${repo.repo}`
    if (this.rawChangelogCache.has(cacheKey)) {
      return this.rawChangelogCache.get(cacheKey)!
    }

    const branches = ['main', 'master']
    const filenames = ['CHANGELOG.md', 'CHANGES.md', 'HISTORY.md']

    for (const branch of branches) {
      for (const filename of filenames) {
        try {
          const response = await fetch(
            `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}/${filename}`,
            {
              method: 'GET',
              signal,
            }
          )

          if (response.ok) {
            const text = await response.text()
            this.rawChangelogCache.set(cacheKey, text)
            return text
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw error
          }
        }
      }
    }

    this.rawChangelogCache.set(cacheKey, null)
    return null
  }
}
