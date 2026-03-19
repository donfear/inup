import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ChangelogFetcher } from '../../src/services/changelog-fetcher'
import { getAllPackageData } from '../../src/services/npm-registry'
import { fetchExactPackageManifest } from '../../src/services/jsdelivr-registry'
import { PACKAGE_NAME } from '../../src/config/constants'

describe('Services Integration Tests', () => {
  const packageVersion = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf-8')
  ).version as string

  describe(`ChangelogFetcher with ${PACKAGE_NAME}`, () => {
    let fetcher: ChangelogFetcher

    beforeEach(() => {
      fetcher = new ChangelogFetcher()
      fetcher.clearCache()
    })

    it(`should fetch metadata for ${PACKAGE_NAME}`, async () => {
      const metadata = await fetcher.fetchPackageMetadata(PACKAGE_NAME, packageVersion)

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
      await fetcher.fetchPackageMetadata('inup', packageVersion)
      const duration1 = Date.now() - start1

      const start2 = Date.now()
      await fetcher.fetchPackageMetadata('inup', packageVersion)
      const duration2 = Date.now() - start2

      // Second fetch should be significantly faster (cached)
      expect(duration2).toBeLessThan(duration1 / 2)
    }, 10000)
  })

  describe(`npm-registry with ${PACKAGE_NAME}`, () => {
    it(`should fetch version data for ${PACKAGE_NAME}`, async () => {
      const result = await getAllPackageData([PACKAGE_NAME])

      expect(result.size).toBe(1)
      const testData = result.get(PACKAGE_NAME)
      expect(testData).toBeDefined()
      expect(testData?.latestVersion).toMatch(/^\d+\.\d+\.\d+$/)
      expect(testData?.allVersions.length).toBeGreaterThan(0)
      expect(testData?.allVersions[0]).toBe(testData?.latestVersion)
    }, 10000)

    it('should filter out pre-release versions', async () => {
      const result = await getAllPackageData([PACKAGE_NAME])

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
    }, 10000)

    it('should track progress with callback', async () => {
      const progressUpdates: Array<{ package: string; completed: number; total: number }> = []

      await getAllPackageData([PACKAGE_NAME, PACKAGE_NAME, PACKAGE_NAME], (pkg, completed, total) => {
        progressUpdates.push({ package: pkg, completed, total })
      })

      expect(progressUpdates.length).toBe(3)
      expect(progressUpdates[0].total).toBe(3)
      expect(progressUpdates[2].completed).toBe(3)
    }, 10000)
  })

  describe(`jsdelivr exact manifest with ${PACKAGE_NAME}`, () => {
    it(`should fetch exact package manifest for ${PACKAGE_NAME}`, async () => {
      const manifest = await fetchExactPackageManifest(PACKAGE_NAME, packageVersion)

      expect(manifest).not.toBeNull()
      expect(manifest?.name).toBe(PACKAGE_NAME)
      expect(manifest?.version).toBe(packageVersion)
    }, 10000)

    it('should reject non-exact version lookups', async () => {
      const manifest = await fetchExactPackageManifest(PACKAGE_NAME, 'latest')

      expect(manifest).toBeNull()
    })
  })
})
