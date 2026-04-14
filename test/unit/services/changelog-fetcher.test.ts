import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
const { fetchExactPackageManifestMock } = vi.hoisted(() => ({
  fetchExactPackageManifestMock: vi.fn(),
}))

vi.mock('../../../src/services/jsdelivr-registry', () => ({
  fetchExactPackageManifest: fetchExactPackageManifestMock,
}))

import { ChangelogFetcher } from '../../../src/services/changelog-fetcher'

describe('ChangelogFetcher', () => {
  let fetcher: ChangelogFetcher
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetcher = new ChangelogFetcher()
    fetcher.clearCache()
    fetchMock.mockReset()
    fetchExactPackageManifestMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('fetchPackageMetadata()', () => {
    it('prefers an exact jsdelivr manifest when a pinned version is provided', async () => {
      fetchExactPackageManifestMock.mockResolvedValue({
        description: 'Demo package',
        homepage: 'https://example.com',
        repository: { url: 'git+https://github.com/demo/repo.git' },
        bugs: { url: 'https://github.com/demo/repo/issues' },
        keywords: ['demo'],
        author: { name: 'Demo Author' },
        license: 'MIT',
      })
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ downloads: 1234 }),
      })

      const metadata = await fetcher.fetchPackageMetadata('demo-pkg', '1.2.3')

      expect(fetchExactPackageManifestMock).toHaveBeenCalledWith('demo-pkg', '1.2.3')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(metadata?.repositoryUrl).toBe('https://github.com/demo/repo')
      expect(metadata?.weeklyDownloads).toBe(1234)
    })

    it('fetches metadata from npm registry and download stats once', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            description: 'Demo package',
            homepage: 'https://example.com',
            repository: { url: 'git+https://github.com/demo/repo.git' },
            bugs: { url: 'https://github.com/demo/repo/issues' },
            keywords: ['demo'],
            author: { name: 'Demo Author' },
            license: 'MIT',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ downloads: 1234 }),
        })

      const metadata = await fetcher.fetchPackageMetadata('demo-pkg')

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(metadata).toEqual({
        description: 'Demo package',
        homepage: 'https://example.com',
        repository: { url: 'git+https://github.com/demo/repo.git' },
        bugs: { url: 'https://github.com/demo/repo/issues' },
        keywords: ['demo'],
        author: 'Demo Author',
        license: 'MIT',
        repositoryUrl: 'https://github.com/demo/repo',
        npmUrl: 'https://www.npmjs.com/package/demo-pkg',
        issuesUrl: 'https://github.com/demo/repo/issues',
        releaseNotes: 'https://github.com/demo/repo/releases',
        weeklyDownloads: 1234,
      })
    })

    it('returns null for nonexistent package and memoizes the failure', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: async () => ({}),
      })

      const first = await fetcher.fetchPackageMetadata('missing-pkg')
      const second = await fetcher.fetchPackageMetadata('missing-pkg')

      expect(first).toBeNull()
      expect(second).toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('reuses cached metadata on repeated calls', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            description: 'Demo package',
            repository: { url: 'https://github.com/demo/repo.git' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ downloads: 42 }),
        })

      const first = await fetcher.fetchPackageMetadata('demo-pkg')
      const second = await fetcher.fetchPackageMetadata('demo-pkg')

      expect(first).toEqual(second)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('dedupes concurrent requests while metadata is in flight', async () => {
      let resolveRegistry:
        | ((value: {
            ok: boolean
            json: () => Promise<Record<string, unknown>>
          }) => void)
        | undefined
      let resolveDownloads:
        | ((value: {
            ok: boolean
            json: () => Promise<Record<string, unknown>>
          }) => void)
        | undefined

      fetchMock
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveRegistry = resolve
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveDownloads = resolve
            })
        )

      const first = fetcher.fetchPackageMetadata('demo-pkg')
      const second = fetcher.fetchPackageMetadata('demo-pkg')

      expect(fetchMock).toHaveBeenCalledTimes(1)

      resolveRegistry?.({
        ok: true,
        json: async () => ({
          description: 'Demo package',
          repository: { url: 'https://github.com/demo/repo.git' },
        }),
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(fetchMock).toHaveBeenCalledTimes(2)

      resolveDownloads?.({
        ok: true,
        json: async () => ({ downloads: 7 }),
      })

      const [firstResult, secondResult] = await Promise.all([first, second])

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(firstResult).toEqual(secondResult)
    })
  })

  describe('getRepositoryReleaseUrl()', () => {
    it('should return release URL for cached package', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            description: 'Demo package',
            repository: { url: 'https://github.com/demo/repo.git' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ downloads: 7 }),
        })

      await fetcher.fetchPackageMetadata('demo-pkg')

      const releaseUrl = fetcher.getRepositoryReleaseUrl('demo-pkg', '1.0.0')

      expect(releaseUrl).toBe('https://github.com/demo/repo/releases/tag/v1.0.0')
    })

    it('should return null for uncached package', () => {
      const releaseUrl = fetcher.getRepositoryReleaseUrl('unknown-package', '1.0.0')

      expect(releaseUrl).toBeNull()
    })
  })

  describe('cacheMetadata()', () => {
    it('should cache metadata directly', () => {
      const rawData = {
        description: 'Test package',
        homepage: 'https://example.com',
        repository: { url: 'https://github.com/test/repo' },
        keywords: ['test'],
        author: { name: 'Test Author' },
        license: 'MIT',
      }

      fetcher.cacheMetadata('test-package', rawData)

      const releaseUrl = fetcher.getRepositoryReleaseUrl('test-package', '1.0.0')

      expect(releaseUrl).toBeTruthy()
      expect(releaseUrl).toContain('github.com/test/repo')
    })

    it('should handle minimal metadata', () => {
      const rawData = {
        description: 'Test',
      }

      fetcher.cacheMetadata('test-package', rawData)

      const releaseUrl = fetcher.getRepositoryReleaseUrl('test-package', '1.0.0')

      expect(releaseUrl).toBeNull()
    })
  })

  describe('fetchReleaseNotesForVersion()', () => {
    it('reuses package metadata fetched for the latest version when loading older release notes', async () => {
      fetchExactPackageManifestMock.mockResolvedValue({
        description: 'Demo package',
        repository: { url: 'git+https://github.com/demo/repo.git' },
      })

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ downloads: 42 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            body: '## Changes\n- Fixed older release',
          }),
        })

      await fetcher.fetchPackageMetadata('demo-pkg', '2.0.0')
      const notes = await fetcher.fetchReleaseNotesForVersion('demo-pkg', '1.9.0')

      expect(notes).toContain('Fixed older release')
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        'https://api.github.com/repos/demo/repo/releases/tags/v1.9.0'
      )
    })

    it('falls back to the releases list when exact tag lookups fail', async () => {
      fetchExactPackageManifestMock.mockResolvedValue({
        description: 'Demo package',
        repository: { url: 'git+https://github.com/demo/repo.git' },
      })

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ downloads: 42 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              tag_name: 'next-v1.9.0',
              body: '## Changes\n- Release list fallback worked',
            },
          ],
        })

      await fetcher.fetchPackageMetadata('demo-pkg', '2.0.0')
      const notes = await fetcher.fetchReleaseNotesForVersion('demo-pkg', '1.9.0')

      expect(notes).toContain('Release list fallback worked')
      expect(fetchMock.mock.calls[3]?.[0]).toBe(
        'https://api.github.com/repos/demo/repo/releases?per_page=100&page=1'
      )
    })

    it('caches the releases list fallback across multiple version lookups', async () => {
      fetchExactPackageManifestMock.mockResolvedValue({
        description: 'Demo package',
        repository: { url: 'git+https://github.com/demo/repo.git' },
      })

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ downloads: 42 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              tag_name: 'release-1.9.0',
              body: 'Older notes',
            },
            {
              tag_name: 'release-1.8.0',
              body: 'Even older notes',
            },
          ],
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({}),
        })

      await fetcher.fetchPackageMetadata('demo-pkg', '2.0.0')

      const firstNotes = await fetcher.fetchReleaseNotesForVersion('demo-pkg', '1.9.0')
      const secondNotes = await fetcher.fetchReleaseNotesForVersion('demo-pkg', '1.8.0')

      expect(firstNotes).toContain('Older notes')
      expect(secondNotes).toContain('Even older notes')
      expect(fetchMock).toHaveBeenCalledTimes(6)
      expect(
        fetchMock.mock.calls.filter(
          ([url]) => url === 'https://api.github.com/repos/demo/repo/releases?per_page=100&page=1'
        )
      ).toHaveLength(1)
    })
  })

  describe('abort signal support', () => {
    it('aborts metadata fetch when signal is triggered', async () => {
      const controller = new AbortController()
      let fetchResolve: ((value: any) => void) | undefined

      fetchMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            fetchResolve = resolve
          })
      )

      const promise = fetcher.fetchPackageMetadata('demo-pkg', '1.0.0', controller.signal)
      controller.abort()

      await expect(promise).rejects.toThrow()
    })

    it('aborts release notes fetch when signal is triggered', async () => {
      fetchExactPackageManifestMock.mockResolvedValue({
        description: 'Demo package',
        repository: { url: 'git+https://github.com/demo/repo.git' },
      })

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ downloads: 42 }),
      })

      await fetcher.fetchPackageMetadata('demo-pkg', '2.0.0')

      const controller = new AbortController()
      fetchMock.mockImplementation(
        (_url: string, options?: { signal?: AbortSignal }) =>
          new Promise((resolve, reject) => {
            const signal = options?.signal
            if (signal?.aborted) {
              reject(new DOMException('The operation was aborted.', 'AbortError'))
              return
            }
            const onAbort = () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            }
            signal?.addEventListener('abort', onAbort, { once: true })
          })
      )

      // Abort before calling so the signal is already aborted
      controller.abort()
      const result = await fetcher.fetchReleaseNotesForVersion('demo-pkg', '1.9.0', controller.signal)
      expect(result).toBeNull()
    })
  })

  describe('clearCache()', () => {
    it('should clear both success and failure caches', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            description: 'Demo package',
            repository: { url: 'https://github.com/demo/repo.git' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ downloads: 7 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            description: 'Demo package',
            repository: { url: 'https://github.com/demo/repo.git' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ downloads: 7 }),
        })

      await fetcher.fetchPackageMetadata('demo-pkg')
      await fetcher.fetchPackageMetadata('missing-pkg')
      fetcher.clearCache()
      await fetcher.fetchPackageMetadata('demo-pkg')

      expect(fetchMock).toHaveBeenCalledTimes(5)
    })
  })
})
