import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubClient } from '../../../../src/features/changelog/clients/github-client'
import type { GitHubRelease } from '../../../../src/features/changelog/types'

const REPO_URL = 'https://github.com/octo/demo'
const signal = new AbortController().signal

const fetchMock = vi.fn()

const jsonResponse = (data: unknown, ok = true) => ({
  ok,
  json: async () => data,
  text: async () => JSON.stringify(data),
})

const textResponse = (text: string, ok = true) => ({
  ok,
  json: async () => JSON.parse(text),
  text: async () => text,
})

const abortError = () => new DOMException('aborted', 'AbortError')

const makeRelease = (overrides?: Partial<GitHubRelease>): GitHubRelease =>
  ({
    tag_name: 'v1.0.0',
    draft: false,
    body: 'notes',
    ...overrides,
  }) as GitHubRelease

let client: GitHubClient

beforeEach(() => {
  client = new GitHubClient()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('GitHubClient.fetchReleaseByTag', () => {
  it('returns null for unparseable repository URLs without fetching', async () => {
    expect(await client.fetchReleaseByTag('not-a-github-url', 'v1.0.0', signal)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches the release body from the GitHub API', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ body: '  release notes  ' }))

    const body = await client.fetchReleaseByTag(REPO_URL, 'v1.0.0', signal)

    expect(body).toBe('release notes')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/octo/demo/releases/tags/v1.0.0',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('authenticates api.github.com requests when GITHUB_TOKEN is set', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'gh-token-123')
    fetchMock.mockResolvedValue(jsonResponse({ body: 'notes' }))

    await client.fetchReleaseByTag(REPO_URL, 'v1.0.0', signal)

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('api.github.com'),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer gh-token-123' }),
      })
    )
  })

  it('stays anonymous without an ambient token', async () => {
    vi.stubEnv('GITHUB_TOKEN', '')
    vi.stubEnv('GH_TOKEN', '')
    fetchMock.mockResolvedValue(jsonResponse({ body: 'notes' }))

    await client.fetchReleaseByTag(REPO_URL, 'v1.0.0', signal)

    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers
    expect(headers['authorization']).toBeUndefined()
  })

  it('returns null for missing releases, empty bodies, and network errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false))
    expect(await client.fetchReleaseByTag(REPO_URL, 'v1.0.0', signal)).toBeNull()

    fetchMock.mockResolvedValueOnce(jsonResponse({ body: '   ' }))
    expect(await client.fetchReleaseByTag(REPO_URL, 'v1.0.0', signal)).toBeNull()

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await client.fetchReleaseByTag(REPO_URL, 'v1.0.0', signal)).toBeNull()
  })

  it('rethrows aborts so callers can distinguish cancellation', async () => {
    fetchMock.mockRejectedValue(abortError())

    await expect(client.fetchReleaseByTag(REPO_URL, 'v1.0.0', signal)).rejects.toThrow('aborted')
  })
})

describe('GitHubClient.fetchReleasePageHtml', () => {
  it('returns the raw release page HTML', async () => {
    fetchMock.mockResolvedValue(textResponse('<html>release</html>'))

    const html = await client.fetchReleasePageHtml(REPO_URL, 'v1.0.0', signal)

    expect(html).toBe('<html>release</html>')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://github.com/octo/demo/releases/tag/v1.0.0',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('returns null on missing pages and network errors', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('', false))
    expect(await client.fetchReleasePageHtml(REPO_URL, 'v1.0.0', signal)).toBeNull()

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await client.fetchReleasePageHtml(REPO_URL, 'v1.0.0', signal)).toBeNull()
  })

  it('returns null for unparseable repository URLs and rethrows aborts', async () => {
    expect(await client.fetchReleasePageHtml('nope', 'v1.0.0', signal)).toBeNull()

    fetchMock.mockRejectedValue(abortError())
    await expect(client.fetchReleasePageHtml(REPO_URL, 'v1.0.0', signal)).rejects.toThrow('aborted')
  })
})

describe('GitHubClient.fetchReleases', () => {
  it('collects a single page and caches the result', async () => {
    fetchMock.mockResolvedValue(jsonResponse([makeRelease()]))

    const first = await client.fetchReleases(REPO_URL, signal)
    const second = await client.fetchReleases(REPO_URL, signal)

    expect(first).toHaveLength(1)
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('paginates while pages come back full', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => makeRelease({ tag_name: `v1.0.${i}` }))
    fetchMock
      .mockResolvedValueOnce(jsonResponse(fullPage))
      .mockResolvedValueOnce(jsonResponse([makeRelease({ tag_name: 'v2.0.0' })]))

    const releases = await client.fetchReleases(REPO_URL, signal)

    expect(releases).toHaveLength(101)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('page=2'),
      expect.anything()
    )
  })

  it('stops at the page limit even when every page is full', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => makeRelease({ tag_name: `v1.0.${i}` }))
    fetchMock.mockResolvedValue(jsonResponse(fullPage))

    const releases = await client.fetchReleases(REPO_URL, signal)

    expect(releases).toHaveLength(300)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('caches a null result when the API has no releases', async () => {
    fetchMock.mockResolvedValue(jsonResponse([], true))

    expect(await client.fetchReleases(REPO_URL, signal)).toBeNull()
    expect(await client.fetchReleases(REPO_URL, signal)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats non-array payloads and failed pages as the end of the list', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'rate limited' }))
    expect(await client.fetchReleases(REPO_URL, signal)).toBeNull()

    client.clearCache()
    fetchMock.mockResolvedValueOnce(jsonResponse(null, false))
    expect(await client.fetchReleases(REPO_URL, signal)).toBeNull()
  })

  it('keeps earlier pages when a later page errors', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => makeRelease({ tag_name: `v1.0.${i}` }))
    fetchMock
      .mockResolvedValueOnce(jsonResponse(fullPage))
      .mockRejectedValueOnce(new Error('offline'))

    const releases = await client.fetchReleases(REPO_URL, signal)

    expect(releases).toHaveLength(100)
  })

  it('returns null for unparseable repository URLs and rethrows aborts', async () => {
    expect(await client.fetchReleases('nope', signal)).toBeNull()

    fetchMock.mockRejectedValue(abortError())
    await expect(client.fetchReleases(REPO_URL, signal)).rejects.toThrow('aborted')
  })

  it('refetches after clearCache', async () => {
    fetchMock.mockResolvedValue(jsonResponse([makeRelease()]))
    await client.fetchReleases(REPO_URL, signal)

    client.clearCache()
    await client.fetchReleases(REPO_URL, signal)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('GitHubClient.fetchRawChangelog', () => {
  it('returns the first changelog file that exists and caches it', async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse('', false)) // main/CHANGELOG.md
      .mockResolvedValueOnce(textResponse('# Changelog')) // main/CHANGES.md

    const first = await client.fetchRawChangelog(REPO_URL, signal)
    const second = await client.fetchRawChangelog(REPO_URL, signal)

    expect(first).toBe('# Changelog')
    expect(second).toBe('# Changelog')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://raw.githubusercontent.com/octo/demo/main/CHANGELOG.md',
      expect.anything()
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://raw.githubusercontent.com/octo/demo/main/CHANGES.md',
      expect.anything()
    )
  })

  it('tries every branch and filename combination before caching null', async () => {
    fetchMock.mockResolvedValue(textResponse('', false))

    expect(await client.fetchRawChangelog(REPO_URL, signal)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(6) // 2 branches × 3 filenames

    expect(await client.fetchRawChangelog(REPO_URL, signal)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(6) // cached
  })

  it('skips candidates that error and keeps trying', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(textResponse('# History'))

    expect(await client.fetchRawChangelog(REPO_URL, signal)).toBe('# History')
  })

  it('returns null for unparseable repository URLs and rethrows aborts', async () => {
    expect(await client.fetchRawChangelog('nope', signal)).toBeNull()

    fetchMock.mockRejectedValue(abortError())
    await expect(client.fetchRawChangelog(REPO_URL, signal)).rejects.toThrow('aborted')
  })
})
