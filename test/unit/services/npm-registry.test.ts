import { describe, it, expect, beforeEach } from 'vitest'
import { getAllPackageData, clearPackageCache } from '../../../src/services/npm-registry'

describe('npm-registry', () => {
  beforeEach(() => {
    clearPackageCache()
  })

  describe('getAllPackageData()', () => {
    it('should fetch package data for inup from npm registry', async () => {
      const result = await getAllPackageData(['inup'])

      expect(result.size).toBe(1)
      const inupData = result.get('inup')
      expect(inupData).toBeDefined()
      expect(inupData?.latestVersion).toMatch(/^\d+\.\d+\.\d+$/)
      expect(inupData?.allVersions).toBeDefined()
      expect(inupData?.allVersions.length).toBeGreaterThan(0)
    }, 10000)

    it('should filter out pre-release versions for inup', async () => {
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

    it('should return empty map for empty input', async () => {
      const result = await getAllPackageData([])

      expect(result.size).toBe(0)
    })

    it('should cache package data for inup', async () => {
      const start1 = Date.now()
      await getAllPackageData(['inup'])
      const duration1 = Date.now() - start1

      const start2 = Date.now()
      await getAllPackageData(['inup'])
      const duration2 = Date.now() - start2

      // Second fetch should be significantly faster (cached)
      expect(duration2).toBeLessThan(duration1 / 2)
    }, 10000)

    it('should call progress callback', async () => {
      const progressUpdates: Array<{ package: string; completed: number; total: number }> = []

      await getAllPackageData(['inup', 'inup'], (pkg, completed, total) => {
        progressUpdates.push({ package: pkg, completed, total })
      })

      expect(progressUpdates.length).toBe(2)
      expect(progressUpdates[0].total).toBe(2)
      expect(progressUpdates[0].completed).toBe(1)
      expect(progressUpdates[1].completed).toBe(2)
    }, 10000)

    it('should sort versions correctly for inup', async () => {
      const result = await getAllPackageData(['inup'])

      const inupData = result.get('inup')
      expect(inupData).toBeDefined()

      // Versions should be sorted in descending order
      if (inupData && inupData.allVersions.length > 1) {
        const versions = inupData.allVersions
        // First version should be the latest
        expect(versions[0]).toBe(inupData.latestVersion)

        // Verify descending order
        for (let i = 0; i < versions.length - 1; i++) {
          const current = versions[i].split('.').map(Number)
          const next = versions[i + 1].split('.').map(Number)

          // Current should be >= next
          const currentNum = current[0] * 10000 + current[1] * 100 + current[2]
          const nextNum = next[0] * 10000 + next[1] * 100 + next[2]
          expect(currentNum).toBeGreaterThanOrEqual(nextNum)
        }
      }
    }, 10000)
  })

  describe('clearPackageCache()', () => {
    it('should clear the cache for inup', async () => {
      // First fetch
      await getAllPackageData(['inup'])

      // Clear cache
      clearPackageCache()

      // Second fetch should hit the network again
      const start = Date.now()
      await getAllPackageData(['inup'])
      const duration = Date.now() - start

      // Should take some time (not instant from cache)
      expect(duration).toBeGreaterThan(10)
    }, 10000)
  })
})
