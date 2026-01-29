import { describe, it, expect, beforeEach } from 'vitest'
import { ChangelogFetcher } from '../../../src/services/changelog-fetcher'

describe('ChangelogFetcher', () => {
  let fetcher: ChangelogFetcher

  beforeEach(() => {
    fetcher = new ChangelogFetcher()
    fetcher.clearCache()
  })

  describe('fetchPackageMetadata()', () => {
    it('should fetch metadata for inup', async () => {
      const metadata = await fetcher.fetchPackageMetadata('inup')

      expect(metadata).not.toBeNull()
      expect(metadata?.description).toBeTruthy()
      expect(metadata?.repositoryUrl).toBeTruthy()
      expect(metadata?.repositoryUrl).toContain('github.com')
      expect(metadata?.npmUrl).toBe('https://www.npmjs.com/package/inup')
      expect(metadata?.license).toBeTruthy()
    }, 10000)

    it('should return null for nonexistent package', async () => {
      const metadata = await fetcher.fetchPackageMetadata('this-package-definitely-does-not-exist-123456789')

      expect(metadata).toBeNull()
    }, 10000)

    it('should use cache on second fetch', async () => {
      const start1 = Date.now()
      await fetcher.fetchPackageMetadata('inup')
      const duration1 = Date.now() - start1

      const start2 = Date.now()
      await fetcher.fetchPackageMetadata('inup')
      const duration2 = Date.now() - start2

      // Second fetch should be significantly faster (cached)
      expect(duration2).toBeLessThan(duration1 / 2)
    }, 10000)

    it('should cache failures to avoid retrying', async () => {
      const start1 = Date.now()
      await fetcher.fetchPackageMetadata('nonexistent-package-xyz-123')
      const duration1 = Date.now() - start1

      const start2 = Date.now()
      await fetcher.fetchPackageMetadata('nonexistent-package-xyz-123')
      const duration2 = Date.now() - start2

      // Second fetch should be instant (cached failure)
      expect(duration2).toBeLessThan(10)
    }, 10000)

    it('should extract repository URL correctly', async () => {
      const metadata = await fetcher.fetchPackageMetadata('inup')

      expect(metadata).not.toBeNull()
      expect(metadata?.repositoryUrl).toBeTruthy()
      // Should not have .git suffix
      expect(metadata?.repositoryUrl).not.toContain('.git')
      // Should not have git+ prefix
      expect(metadata?.repositoryUrl).toMatch(/^https?:\/\//)
    }, 10000)

    it('should generate release notes URL', async () => {
      const metadata = await fetcher.fetchPackageMetadata('inup')

      expect(metadata).not.toBeNull()
      if (metadata?.repositoryUrl) {
        expect(metadata.releaseNotes).toBe(`${metadata.repositoryUrl}/releases`)
      }
    }, 10000)

    it('should generate issues URL', async () => {
      const metadata = await fetcher.fetchPackageMetadata('inup')

      expect(metadata).not.toBeNull()
      if (metadata?.repositoryUrl) {
        expect(metadata.issuesUrl).toBe(`${metadata.repositoryUrl}/issues`)
      }
    }, 10000)

    it('should fetch weekly downloads', async () => {
      const metadata = await fetcher.fetchPackageMetadata('inup')

      expect(metadata).not.toBeNull()
      // Weekly downloads should exist and be a positive number
      expect(metadata?.weeklyDownloads).toBeDefined()
      if (metadata?.weeklyDownloads !== undefined) {
        expect(metadata.weeklyDownloads).toBeGreaterThanOrEqual(0)
      }
    }, 10000)
  })

  describe('getRepositoryReleaseUrl()', () => {
    it('should return release URL for cached package', async () => {
      await fetcher.fetchPackageMetadata('inup')

      const releaseUrl = fetcher.getRepositoryReleaseUrl('inup', '1.0.0')

      expect(releaseUrl).toBeTruthy()
      expect(releaseUrl).toContain('/releases/tag/v1.0.0')
    }, 10000)

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

  describe('clearCache()', () => {
    it('should clear both success and failure caches', async () => {
      // Fetch inup
      await fetcher.fetchPackageMetadata('inup')

      // Fetch nonexistent package (failure)
      await fetcher.fetchPackageMetadata('nonexistent-pkg-xyz')

      // Clear cache
      fetcher.clearCache()

      // Both should be refetched
      const start = Date.now()
      await fetcher.fetchPackageMetadata('inup')
      const duration = Date.now() - start

      expect(duration).toBeGreaterThan(10)
    }, 10000)
  })
})
