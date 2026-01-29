import { describe, it, expect, beforeEach } from 'vitest'
import { ChangelogFetcher } from '../../src/services/changelog-fetcher'
import { getAllPackageData } from '../../src/services/npm-registry'
import { getAllPackageDataFromJsdelivr } from '../../src/services/jsdelivr-registry'
import { TEST_PACKAGE_NAME } from '../../src/config/constants'

describe('Services Integration Tests', () => {
  describe(`ChangelogFetcher with ${TEST_PACKAGE_NAME}`, () => {
    let fetcher: ChangelogFetcher

    beforeEach(() => {
      fetcher = new ChangelogFetcher()
      fetcher.clearCache()
    })

    it(`should fetch metadata for ${TEST_PACKAGE_NAME}`, async () => {
      const metadata = await fetcher.fetchPackageMetadata(TEST_PACKAGE_NAME)

      expect(metadata).not.toBeNull()
      expect(metadata?.description).toBeTruthy()
      expect(metadata?.repositoryUrl).toBeTruthy()
      expect(metadata?.repositoryUrl).toContain('github.com')
      expect(metadata?.npmUrl).toBe('https://www.npmjs.com/package/inup')
      expect(metadata?.license).toBeTruthy()
    }, 10000)

    it('should return null for nonexistent package', async () => {
      const metadata = await fetcher.fetchPackageMetadata('this-package-definitely-does-not-exist-xyz123')

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
  })

  describe(`npm-registry with ${TEST_PACKAGE_NAME}`, () => {
    it(`should fetch version data for ${TEST_PACKAGE_NAME}`, async () => {
      const result = await getAllPackageData([TEST_PACKAGE_NAME])

      expect(result.size).toBe(1)
      const testData = result.get(TEST_PACKAGE_NAME)
      expect(testData).toBeDefined()
      expect(testData?.latestVersion).toMatch(/^\d+\.\d+\.\d+$/)
      expect(testData?.allVersions.length).toBeGreaterThan(0)
      expect(testData?.allVersions[0]).toBe(testData?.latestVersion)
    }, 10000)

    it('should filter out pre-release versions', async () => {
      const result = await getAllPackageData([TEST_PACKAGE_NAME])

      const testData = result.get(TEST_PACKAGE_NAME)
      expect(testData).toBeDefined()

      // All versions should be stable (X.Y.Z format, no -beta, -rc, etc.)
      testData?.allVersions.forEach((version: string) => {
        expect(version).toMatch(/^\d+\.\d+\.\d+$/)
        expect(version).not.toContain('-')
        expect(version).not.toContain('alpha')
        expect(version).not.toContain('beta')
        expect(version).not.toContain('rc')
      })
    }, 10000)

    it('should track progress with callback', async () => {
      const progressUpdates: Array<{ package: string; completed: number; total: number }> = []

      await getAllPackageData([TEST_PACKAGE_NAME, TEST_PACKAGE_NAME, TEST_PACKAGE_NAME], (pkg, completed, total) => {
        progressUpdates.push({ package: pkg, completed, total })
      })

      expect(progressUpdates.length).toBe(3)
      expect(progressUpdates[0].total).toBe(3)
      expect(progressUpdates[2].completed).toBe(3)
    }, 10000)
  })

  describe(`jsdelivr-registry with ${TEST_PACKAGE_NAME}`, () => {
    it(`should fetch version data for ${TEST_PACKAGE_NAME} from jsdelivr`, async () => {
      const result = await getAllPackageDataFromJsdelivr([TEST_PACKAGE_NAME])

      expect(result.size).toBe(1)
      const testData = result.get(TEST_PACKAGE_NAME)
      expect(testData).toBeDefined()
      expect(testData?.latestVersion).toMatch(/^\d+\.\d+\.\d+$/)
      expect(testData?.allVersions.length).toBeGreaterThan(0)
    }, 10000)

    it('should fetch both latest and major version', async () => {
      const currentVersions = new Map([[TEST_PACKAGE_NAME, '1.0.0']])

      const result = await getAllPackageDataFromJsdelivr([TEST_PACKAGE_NAME], currentVersions)

      const testData = result.get(TEST_PACKAGE_NAME)
      expect(testData).toBeDefined()
      expect(testData?.allVersions.length).toBeGreaterThanOrEqual(1)

      // Should have at least the latest version
      expect(testData?.latestVersion).toBeTruthy()
    }, 10000)

    it('should track progress with callback', async () => {
      const progressUpdates: Array<{ package: string; completed: number; total: number }> = []

      await getAllPackageDataFromJsdelivr(
        [TEST_PACKAGE_NAME, TEST_PACKAGE_NAME, TEST_PACKAGE_NAME],
        undefined,
        (pkg, completed, total) => {
          progressUpdates.push({ package: pkg, completed, total })
        }
      )

      expect(progressUpdates.length).toBe(3)
      expect(progressUpdates[0].total).toBe(3)
      expect(progressUpdates[2].completed).toBe(3)
    }, 15000)
  })

  describe('Performance comparison: npm vs jsdelivr', () => {
    it(`should compare fetch performance for ${TEST_PACKAGE_NAME}`, async () => {
      // Test npm registry
      const npmStart = Date.now()
      await getAllPackageData([TEST_PACKAGE_NAME])
      const npmDuration = Date.now() - npmStart

      // Test jsdelivr
      const jsdelivrStart = Date.now()
      await getAllPackageDataFromJsdelivr([TEST_PACKAGE_NAME])
      const jsdelivrDuration = Date.now() - jsdelivrStart

      // Both should complete in reasonable time
      expect(npmDuration).toBeLessThan(10000)
      expect(jsdelivrDuration).toBeLessThan(10000)

      // Log the comparison (for informational purposes)
      console.log(`npm registry: ${npmDuration}ms`)
      console.log(`jsdelivr: ${jsdelivrDuration}ms`)
    }, 20000)
  })
})
