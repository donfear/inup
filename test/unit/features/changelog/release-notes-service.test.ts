import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReleaseNotesService } from '../../../../src/features/changelog/services/release-notes-service'
import type { PackageMetadataService } from '../../../../src/features/changelog/services/package-metadata-service'
import type { GitHubClient } from '../../../../src/features/changelog/clients/github-client'
import type { GitHubRelease } from '../../../../src/features/changelog/types'

const GITHUB_REPO = 'https://github.com/octo/demo'

const makeRelease = (overrides?: Partial<GitHubRelease>): GitHubRelease =>
  ({
    tag_name: 'v1.0.0',
    draft: false,
    body: 'release body',
    ...overrides,
  }) as GitHubRelease

function makeHarness(repositoryUrl: string | null = GITHUB_REPO) {
  const metadataService = {
    getCached: vi.fn(() => (repositoryUrl ? { repositoryUrl } : null)),
    fetchPackageMetadata: vi.fn(async () => (repositoryUrl ? { repositoryUrl } : null)),
  }
  const githubClient = {
    clearCache: vi.fn(),
    fetchReleasePageHtml: vi.fn(async () => null as string | null),
    fetchReleaseByTag: vi.fn(async () => null as string | null),
    fetchReleases: vi.fn(async () => null as GitHubRelease[] | null),
    fetchRawChangelog: vi.fn(async () => null as string | null),
  }
  const service = new ReleaseNotesService(
    metadataService as unknown as PackageMetadataService,
    githubClient as unknown as GitHubClient
  )
  return { service, metadataService, githubClient }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('ReleaseNotesService source fallback chain', () => {
  it('prefers notes scraped from the GitHub release page', async () => {
    const { service, githubClient } = makeHarness()
    githubClient.fetchReleasePageHtml.mockResolvedValue(
      '<div data-test-selector="body-content"><div class="markdown-body"><p>From the release page</p></div></div>'
    )

    const notes = await service.fetchReleaseNotesForVersion('demo', '1.0.0')

    expect(notes).toBe('From the release page')
    expect(githubClient.fetchReleasePageHtml).toHaveBeenCalledWith(
      GITHUB_REPO,
      'v1.0.0',
      expect.any(AbortSignal)
    )
    expect(githubClient.fetchReleaseByTag).not.toHaveBeenCalled()
  })

  it('falls back to the release API when the page has no notes', async () => {
    const { service, githubClient } = makeHarness()
    githubClient.fetchReleaseByTag.mockResolvedValueOnce('api notes')

    const notes = await service.fetchReleaseNotesForVersion('demo', '1.0.0')

    expect(notes).toBe('api notes')
    // The page source was tried first, for both tag spellings.
    expect(githubClient.fetchReleasePageHtml).toHaveBeenCalledTimes(2)
  })

  it('tries the bare version tag when the v-prefixed tag has no release', async () => {
    const { service, githubClient } = makeHarness()
    githubClient.fetchReleaseByTag.mockImplementation(async (_repo: string, tag: string) =>
      tag === '1.0.0' ? 'bare tag notes' : null
    )

    const notes = await service.fetchReleaseNotesForVersion('demo', '1.0.0')

    expect(notes).toBe('bare tag notes')
    expect(githubClient.fetchReleaseByTag).toHaveBeenNthCalledWith(
      1,
      GITHUB_REPO,
      'v1.0.0',
      expect.any(AbortSignal)
    )
  })

  it('skips page HTML that yields no extractable notes', async () => {
    const { service, githubClient } = makeHarness()
    githubClient.fetchReleasePageHtml.mockResolvedValue('<html><body>no markers</body></html>')
    githubClient.fetchReleaseByTag.mockResolvedValueOnce('api notes')

    const notes = await service.fetchReleaseNotesForVersion('demo', '1.0.0')

    expect(notes).toBe('api notes')
  })

  it('returns null for a version that is not valid semver', async () => {
    const { service, githubClient } = makeHarness()
    githubClient.fetchReleases.mockResolvedValue([makeRelease()])

    const notes = await service.fetchReleaseNotesForVersion('demo', 'not-a-version')

    expect(notes).toBeNull()
  })

  it('falls back to the release list, skipping drafts and normalizing tags', async () => {
    const { service, githubClient } = makeHarness()
    githubClient.fetchReleases.mockResolvedValue([
      makeRelease({ tag_name: 'v1.0.0', draft: true, body: 'draft notes' }),
      makeRelease({ tag_name: 'demo@1.0.0', body: 'list notes' }),
      makeRelease({ tag_name: 'v0.9.0', body: 'older notes' }),
    ])

    const notes = await service.fetchReleaseNotesForVersion('demo', '1.0.0')

    expect(notes).toBe('list notes')
  })

  it('skips list entries with empty bodies', async () => {
    const { service, githubClient } = makeHarness()
    githubClient.fetchReleases.mockResolvedValue([makeRelease({ body: '   ' })])

    expect(await service.fetchReleaseNotesForVersion('demo', '1.0.0')).toBeNull()
  })

  it('falls back to CHANGELOG.md as the last source', async () => {
    const { service, githubClient } = makeHarness()
    githubClient.fetchRawChangelog.mockResolvedValue('## 1.0.0\n\n- from changelog\n\n## 0.9.0\n')

    const notes = await service.fetchReleaseNotesForVersion('demo', '1.0.0')

    expect(notes).toBe('- from changelog')
  })

  it('returns null when every source is exhausted', async () => {
    const { service, githubClient } = makeHarness()

    expect(await service.fetchReleaseNotesForVersion('demo', '1.0.0')).toBeNull()
    expect(githubClient.fetchReleasePageHtml).toHaveBeenCalledTimes(2)
    expect(githubClient.fetchReleaseByTag).toHaveBeenCalledTimes(2)
    expect(githubClient.fetchReleases).toHaveBeenCalledTimes(1)
    expect(githubClient.fetchRawChangelog).toHaveBeenCalledTimes(1)
  })
})

describe('ReleaseNotesService metadata handling', () => {
  it('skips GitHub entirely for non-GitHub repositories', async () => {
    const { service, githubClient } = makeHarness('https://gitlab.com/octo/demo')

    expect(await service.fetchReleaseNotesForVersion('demo', '1.0.0')).toBeNull()
    expect(githubClient.fetchReleasePageHtml).not.toHaveBeenCalled()
  })

  it('fetches metadata when nothing is cached', async () => {
    const { service, metadataService } = makeHarness()
    metadataService.getCached.mockReturnValue(null)

    await service.fetchReleaseNotesForVersion('demo', '1.0.0')

    expect(metadataService.fetchPackageMetadata).toHaveBeenCalledWith(
      'demo',
      '1.0.0',
      expect.any(AbortSignal)
    )
  })

  it('handles packages with no repository metadata at all', async () => {
    const { service } = makeHarness(null)

    expect(await service.fetchReleaseNotesForVersion('demo', '1.0.0')).toBeNull()
  })
})

describe('ReleaseNotesService caching', () => {
  it('caches results per package@version', async () => {
    const { service, githubClient } = makeHarness()
    githubClient.fetchReleaseByTag.mockResolvedValue('api notes')

    await service.fetchReleaseNotesForVersion('demo', '1.0.0')
    await service.fetchReleaseNotesForVersion('demo', '1.0.0')

    expect(githubClient.fetchReleasePageHtml).toHaveBeenCalledTimes(2) // one fetch pass only
  })

  it('deduplicates concurrent requests for the same version', async () => {
    const { service, githubClient } = makeHarness()
    githubClient.fetchReleaseByTag.mockResolvedValue('api notes')

    const [first, second] = await Promise.all([
      service.fetchReleaseNotesForVersion('demo', '1.0.0'),
      service.fetchReleaseNotesForVersion('demo', '1.0.0'),
    ])

    expect(first).toBe('api notes')
    expect(second).toBe('api notes')
    expect(githubClient.fetchReleasePageHtml).toHaveBeenCalledTimes(2) // one pass, two tags
  })

  it('clears its caches and the GitHub client cache together', async () => {
    const { service, githubClient } = makeHarness()
    githubClient.fetchReleaseByTag.mockResolvedValue('api notes')
    await service.fetchReleaseNotesForVersion('demo', '1.0.0')

    service.clearCache()
    await service.fetchReleaseNotesForVersion('demo', '1.0.0')

    expect(githubClient.clearCache).toHaveBeenCalled()
    expect(githubClient.fetchReleasePageHtml).toHaveBeenCalledTimes(4)
  })
})

describe('ReleaseNotesService cancellation', () => {
  it('rejects immediately when the caller signal is already aborted', async () => {
    const { service } = makeHarness()
    const controller = new AbortController()
    controller.abort()

    await expect(
      service.fetchReleaseNotesForVersion('demo', '1.0.0', controller.signal)
    ).rejects.toThrow()
  })
})
