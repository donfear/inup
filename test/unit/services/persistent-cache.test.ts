import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock env-paths before importing the module
const mockCacheDir = join(tmpdir(), `inup-cache-test-${Date.now()}`)

vi.mock('env-paths', () => ({
  default: () => ({
    cache: mockCacheDir,
    config: join(mockCacheDir, 'config'),
    data: join(mockCacheDir, 'data'),
  }),
}))

// Import after mocking
const { persistentCache } = await import('../../../src/services/persistent-cache')

describe('persistent-cache', () => {
  beforeEach(() => {
    // Clear cache before each test
    persistentCache.clearCache()
  })

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(mockCacheDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('get/set', () => {
    it('should return null for non-existent package', () => {
      const result = persistentCache.get('non-existent-package')
      expect(result).toBeNull()
    })

    it('should store and retrieve package data', () => {
      const data = {
        latestVersion: '2.0.0',
        allVersions: ['2.0.0', '1.5.0', '1.0.0'],
      }

      persistentCache.set('test-package', data)
      persistentCache.flush()

      const result = persistentCache.get('test-package')
      expect(result).toEqual(data)
    })

    it('should handle scoped packages', () => {
      const data = {
        latestVersion: '3.0.0',
        allVersions: ['3.0.0', '2.0.0'],
      }

      persistentCache.set('@babel/core', data)
      persistentCache.flush()

      const result = persistentCache.get('@babel/core')
      expect(result).toEqual(data)
    })

    it('should persist data to disk', () => {
      const data = {
        latestVersion: '1.0.0',
        allVersions: ['1.0.0'],
      }

      persistentCache.set('persist-test', data)
      persistentCache.flush()

      // Check that cache directory was created
      const cacheDir = join(mockCacheDir, 'registry')
      expect(existsSync(cacheDir)).toBe(true)

      // Check that index file exists
      const indexPath = join(cacheDir, 'index.json')
      expect(existsSync(indexPath)).toBe(true)

      // Check that package file exists
      const packageFile = join(cacheDir, 'persist-test.json')
      expect(existsSync(packageFile)).toBe(true)
    })
  })

  describe('getMany/setMany', () => {
    it('should batch get multiple packages', () => {
      persistentCache.set('pkg-a', { latestVersion: '1.0.0', allVersions: ['1.0.0'] })
      persistentCache.set('pkg-b', { latestVersion: '2.0.0', allVersions: ['2.0.0'] })
      persistentCache.flush()

      const results = persistentCache.getMany(['pkg-a', 'pkg-b', 'pkg-c'])

      expect(results.size).toBe(2)
      expect(results.get('pkg-a')?.latestVersion).toBe('1.0.0')
      expect(results.get('pkg-b')?.latestVersion).toBe('2.0.0')
      expect(results.has('pkg-c')).toBe(false)
    })

    it('should batch set multiple packages', () => {
      const entries = new Map([
        ['batch-a', { latestVersion: '1.0.0', allVersions: ['1.0.0'] }],
        ['batch-b', { latestVersion: '2.0.0', allVersions: ['2.0.0'] }],
      ])

      persistentCache.setMany(entries)

      expect(persistentCache.get('batch-a')?.latestVersion).toBe('1.0.0')
      expect(persistentCache.get('batch-b')?.latestVersion).toBe('2.0.0')
    })
  })

  describe('clearCache', () => {
    it('should clear all cached data', () => {
      persistentCache.set('to-clear', { latestVersion: '1.0.0', allVersions: ['1.0.0'] })
      persistentCache.flush()

      expect(persistentCache.get('to-clear')).not.toBeNull()

      persistentCache.clearCache()

      expect(persistentCache.get('to-clear')).toBeNull()
    })
  })

  describe('getStats', () => {
    it('should return cache statistics', () => {
      persistentCache.set('stats-a', { latestVersion: '1.0.0', allVersions: ['1.0.0'] })
      persistentCache.set('stats-b', { latestVersion: '2.0.0', allVersions: ['2.0.0'] })
      persistentCache.flush()

      const stats = persistentCache.getStats()

      expect(stats.entries).toBe(2)
      expect(stats.cacheDir).toContain('registry')
    })
  })

  describe('cache file naming', () => {
    it('should handle package names with special characters', () => {
      const packages = [
        '@types/node',
        '@babel/preset-env',
        'lodash.merge',
        '@org/pkg-name',
      ]

      for (const pkg of packages) {
        persistentCache.set(pkg, { latestVersion: '1.0.0', allVersions: ['1.0.0'] })
      }
      persistentCache.flush()

      for (const pkg of packages) {
        const result = persistentCache.get(pkg)
        expect(result).not.toBeNull()
        expect(result?.latestVersion).toBe('1.0.0')
      }
    })
  })
})
