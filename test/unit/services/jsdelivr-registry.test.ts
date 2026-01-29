import { describe, it, expect, beforeEach } from 'vitest'
import {
  getAllPackageDataFromJsdelivr,
  clearJsdelivrPackageCache,
} from '../../../src/services/jsdelivr-registry'
import { PACKAGE_NAME } from '../../../src/config/constants'

describe('jsdelivr-registry', () => {
  beforeEach(() => {
    clearJsdelivrPackageCache()
  })

  describe('getAllPackageDataFromJsdelivr()', () => {
    it('should fetch package data for inup from jsdelivr', async () => {
      const result = await getAllPackageDataFromJsdelivr([PACKAGE_NAME])

      expect(result.size).toBe(1)
      const inupData = result.get(PACKAGE_NAME)
      expect(inupData).toBeDefined()
      expect(inupData?.latestVersion).toMatch(/^\d+\.\d+\.\d+$/)
      expect(inupData?.allVersions).toBeDefined()
      expect(inupData?.allVersions.length).toBeGreaterThan(0)
    }, 10000)

    it('should fetch both latest and major versions for inup', async () => {
      const currentVersions = new Map([[PACKAGE_NAME, '1.0.0']])

      const result = await getAllPackageDataFromJsdelivr([PACKAGE_NAME], currentVersions)

      const inupData = result.get(PACKAGE_NAME)
      expect(inupData).toBeDefined()
      expect(inupData?.latestVersion).toMatch(/^\d+\.\d+\.\d+$/)

      // Should have fetched both latest and major version 1
      expect(inupData?.allVersions.length).toBeGreaterThanOrEqual(1)
    }, 10000)

    it('should not duplicate versions when major equals latest', async () => {
      const result = await getAllPackageDataFromJsdelivr([PACKAGE_NAME])

      const inupData = result.get(PACKAGE_NAME)
      expect(inupData).toBeDefined()

      // Check that all versions are unique
      const uniqueVersions = new Set(inupData?.allVersions)
      expect(uniqueVersions.size).toBe(inupData?.allVersions.length)
    }, 10000)

    it('should return empty map for empty input', async () => {
      const result = await getAllPackageDataFromJsdelivr([])

      expect(result.size).toBe(0)
    })

    it('should cache package data for inup', async () => {
      const start1 = Date.now()
      await getAllPackageDataFromJsdelivr([PACKAGE_NAME])
      const duration1 = Date.now() - start1

      const start2 = Date.now()
      await getAllPackageDataFromJsdelivr([PACKAGE_NAME])
      const duration2 = Date.now() - start2

      // Second fetch should be significantly faster (cached)
      expect(duration2).toBeLessThan(duration1 / 2)
    }, 10000)

    it('should call progress callback', async () => {
      const progressUpdates: Array<{ package: string; completed: number; total: number }> = []

      await getAllPackageDataFromJsdelivr(
        [PACKAGE_NAME, PACKAGE_NAME],
        undefined,
        (pkg, completed, total) => {
          progressUpdates.push({ package: pkg, completed, total })
        }
      )

      expect(progressUpdates.length).toBe(2)
      expect(progressUpdates[0].total).toBe(2)
      expect(progressUpdates[1].completed).toBe(2)
    }, 15000)

    it('should sort versions correctly for inup', async () => {
      const currentVersions = new Map([[PACKAGE_NAME, '1.0.0']])

      const result = await getAllPackageDataFromJsdelivr([PACKAGE_NAME], currentVersions)

      const inupData = result.get(PACKAGE_NAME)
      expect(inupData).toBeDefined()

      // If multiple versions exist, verify they're sorted
      if (inupData && inupData.allVersions.length > 1) {
        const versions = inupData.allVersions
        // First version should be the latest
        expect(versions[0]).toBe(inupData.latestVersion)
      }
    }, 10000)

    it('should extract major version correctly for inup with specific version', async () => {
      const currentVersions = new Map([[PACKAGE_NAME, '1.2.0']])

      const result = await getAllPackageDataFromJsdelivr([PACKAGE_NAME], currentVersions)

      const inupData = result.get(PACKAGE_NAME)
      expect(inupData).toBeDefined()
      expect(inupData?.latestVersion).toMatch(/^\d+\.\d+\.\d+$/)
    }, 10000)
  })

  describe('clearJsdelivrPackageCache()', () => {
    it('should clear the cache for inup', async () => {
      // First fetch
      await getAllPackageDataFromJsdelivr([PACKAGE_NAME])

      // Clear cache
      clearJsdelivrPackageCache()

      // Second fetch should hit the network again
      const start = Date.now()
      await getAllPackageDataFromJsdelivr([PACKAGE_NAME])
      const duration = Date.now() - start

      // Should take some time (not instant from cache)
      expect(duration).toBeGreaterThan(10)
    }, 10000)
  })
})
