import { PACKAGE_NAME } from '../../../shared/config'
import { parseGitHubRepo } from '../parsers/repository-ref'
import type { GitHubRelease } from '../types'

const GITHUB_RELEASES_PAGE_LIMIT = 3

/**
 * Headers for api.github.com requests. Honors an ambient token (GitHub Actions
 * sets GITHUB_TOKEN, gh CLI users often export GH_TOKEN): authenticated requests
 * get 5,000 req/hr instead of the 60 req/hr anonymous limit, which large upgrade
 * sessions can exhaust while fetching release notes.
 */
function githubApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github.v3+json',
    'user-agent': `${PACKAGE_NAME}-cli`,
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) {
    headers.authorization = `Bearer ${token}`
  }
  return headers
}

/**
 * GET an api.github.com URL, retrying anonymously when the ambient token is
 * rejected (401). A stale/revoked GITHUB_TOKEN sitting in the environment must
 * never make release notes *worse* than having no token at all — public-repo
 * requests that used to succeed anonymously keep succeeding.
 */
async function fetchGitHubApi(url: string, signal: AbortSignal): Promise<Response> {
  const headers = githubApiHeaders()
  const response = await fetch(url, { method: 'GET', headers, signal })
  if (response.status === 401 && headers.authorization) {
    const { authorization: _rejected, ...anonymousHeaders } = headers
    return fetch(url, { method: 'GET', headers: anonymousHeaders, signal })
  }
  return response
}

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
      const response = await fetchGitHubApi(
        `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/tags/${tag}`,
        signal
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
        const response = await fetchGitHubApi(
          `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases?per_page=100&page=${page}`,
          signal
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
