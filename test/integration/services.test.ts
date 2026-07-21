import { beforeEach, describe, expect, it } from 'vitest'
import { ChangelogFetcher } from '../../src/features/changelog'
import { PACKAGE_NAME } from '../../src/shared/config/constants'
import { fetchPackageVersions } from '../../src/shared/registry/npm-registry'

// These tests hit the live npm registry. The retry stack alone can honestly
// spend >10s on a struggling CI runner (backoff 0.5+1.5+3s between attempts,
// plus connect stalls), so the budget must exceed that worst case — a 10s
// budget made the first cold request a recurring single-runner flake.
const LIVE_NETWORK_TIMEOUT_MS = 30_000

describe('Services Integration Tests', () => {
  describe(`ChangelogFetcher with ${PACKAGE_NAME}`, () => {
    let fetcher: ChangelogFetcher

    beforeEach(() => {
      fetcher = new ChangelogFetcher()
      fetcher.clearCache()
    })

    it(`should fetch metadata for ${PACKAGE_NAME}`, async () => {
      const packageVersion =
        (await fetchPackageVersions([PACKAGE_NAME])).get(PACKAGE_NAME)?.latestVersion ?? ''

      expect(packageVersion).toMatch(/^\d+\.\d+\.\d+$/)
      const metadata = await fetcher.fetchPackageMetadata(PACKAGE_NAME, packageVersion)

      expect(metadata).not.toBeNull()
      expect(metadata?.description).toBeTruthy()
      expect(metadata?.repositoryUrl).toBeTruthy()
      expect(metadata?.repositoryUrl).toContain('github.com')
      expect(metadata?.npmUrl).toBe('https://www.npmjs.com/package/inup')
      expect(metadata?.license).toBeTruthy()
    }, LIVE_NETWORK_TIMEOUT_MS)

    it('should return null for nonexistent package', async () => {
      const metadata = await fetcher.fetchPackageMetadata(
        'this-package-definitely-does-not-exist-xyz123'
      )

      expect(metadata).toBeNull()
    }, LIVE_NETWORK_TIMEOUT_MS)

    it('should use cache on second fetch', async () => {
      const packageVersion =
        (await fetchPackageVersions([PACKAGE_NAME])).get(PACKAGE_NAME)?.latestVersion ?? ''

      const start1 = Date.now()
      await fetcher.fetchPackageMetadata('inup', packageVersion)
      const duration1 = Date.now() - start1

      const start2 = Date.now()
      await fetcher.fetchPackageMetadata('inup', packageVersion)
      const duration2 = Date.now() - start2

      // Second fetch should be significantly faster (cached)
      expect(duration2).toBeLessThan(duration1 / 2)
    }, LIVE_NETWORK_TIMEOUT_MS)
  })

  describe(`npm-registry with ${PACKAGE_NAME}`, () => {
    it(`should fetch version data for ${PACKAGE_NAME}`, async () => {
      const result = await fetchPackageVersions([PACKAGE_NAME])

      expect(result.size).toBe(1)
      const testData = result.get(PACKAGE_NAME)
      expect(testData).toBeDefined()
      expect(testData?.latestVersion).toMatch(/^\d+\.\d+\.\d+$/)
      expect(testData?.allVersions.length).toBeGreaterThan(0)
      expect(testData?.allVersions[0]).toBe(testData?.latestVersion)
    }, LIVE_NETWORK_TIMEOUT_MS)

    it('should filter out pre-release versions', async () => {
      const result = await fetchPackageVersions([PACKAGE_NAME])

      const testData = result.get(PACKAGE_NAME)
      expect(testData).toBeDefined()

      // All versions should be stable (X.Y.Z format, no -beta, -rc, etc.)
      testData?.allVersions.forEach((version: string) => {
        expect(version).toMatch(/^\d+\.\d+\.\d+$/)
        expect(version).not.toContain('-')
        expect(version).not.toContain('alpha')
        expect(version).not.toContain('beta')
        expect(version).not.toContain('rc')
      })
    }, LIVE_NETWORK_TIMEOUT_MS)
  })
})
