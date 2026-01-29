import { describe, it, expect, beforeEach } from 'vitest'
import { ChangelogFetcher } from '../../src/services/changelog-fetcher'
import { getAllPackageData } from '../../src/services/npm-registry'
import { getAllPackageDataFromJsdelivr } from '../../src/services/jsdelivr-registry'

describe('Services Integration Tests', () => {
  describe('ChangelogFetcher with inup', () => {
    let fetcher: ChangelogFetcher

    beforeEach(() => {
      fetcher = new ChangelogFetcher()
      fetcher.clearCache()
    })

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

  describe('npm-registry with inup', () => {
    it('should fetch version data for inup', async () => {
      const result = await getAllPackageData(['inup'])

      expect(result.size).toBe(1)
      const inupData = result.get('inup')
      expect(inupData).toBeDefined()
      expect(inupData?.latestVersion).toMatch(/^\d+\.\d+\.\d+$/)
      expect(inupData?.allVersions.length).toBeGreaterThan(0)
      expect(inupData?.allVersions[0]).toBe(inupData?.latestVersion)
    }, 10000)

    it('should filter out pre-release versions', async () => {
      const result = await getAllPackageData(['inup'])

      const inupData = result.get('inup')
      expect(inupData).toBeDefined()

      // All versions should be stable (X.Y.Z format, no -beta, -rc, etc.)
      inupData?.allVersions.forEach((version) => {
        expect(version).toMatch(/^\d+\.\d+\.\d+$/)
        expect(version).not.toContain('-')
        expect(version).not.toContain('alpha')
        expect(version).not.toContain('beta')
        expect(version).not.toContain('rc')
      })
    }, 10000)

    it('should track progress with callback', async () => {
      const progressUpdates: Array<{ package: string; completed: number; total: number }> = []

      await getAllPackageData(['inup', 'inup', 'inup'], (pkg, completed, total) => {
        progressUpdates.push({ package: pkg, completed, total })
      })

      expect(progressUpdates.length).toBe(3)
      expect(progressUpdates[0].total).toBe(3)
      expect(progressUpdates[2].completed).toBe(3)
    }, 10000)
  })

  describe('jsdelivr-registry with inup', () => {
    it('should fetch version data for inup from jsdelivr', async () => {
      const result = await getAllPackageDataFromJsdelivr(['inup'])

      expect(result.size).toBe(1)
      const inupData = result.get('inup')
      expect(inupData).toBeDefined()
      expect(inupData?.latestVersion).toMatch(/^\d+\.\d+\.\d+$/)
      expect(inupData?.allVersions.length).toBeGreaterThan(0)
    }, 10000)

    it('should fetch both latest and major version', async () => {
      const currentVersions = new Map([['inup', '1.0.0']])

      const result = await getAllPackageDataFromJsdelivr(['inup'], currentVersions)

      const inupData = result.get('inup')
      expect(inupData).toBeDefined()
      expect(inupData?.allVersions.length).toBeGreaterThanOrEqual(1)

      // Should have at least the latest version
      expect(inupData?.latestVersion).toBeTruthy()
    }, 10000)

    it('should track progress with callback', async () => {
      const progressUpdates: Array<{ package: string; completed: number; total: number }> = []

      await getAllPackageDataFromJsdelivr(
        ['inup', 'inup', 'inup'],
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
    it('should compare fetch performance for inup', async () => {
      // Test npm registry
      const npmStart = Date.now()
      await getAllPackageData(['inup'])
      const npmDuration = Date.now() - npmStart

      // Test jsdelivr
      const jsdelivrStart = Date.now()
      await getAllPackageDataFromJsdelivr(['inup'])
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
