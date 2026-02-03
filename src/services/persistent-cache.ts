import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import envPaths from 'env-paths'

/**
 * Cache entry structure for package version data
 */
interface PackageCacheEntry {
  latestVersion: string
  allVersions: string[]
  timestamp: number
}

/**
 * Persistent cache index structure
 */
interface CacheIndex {
  version: number
  entries: Record<string, { file: string; timestamp: number }>
}

// Cache TTL: 24 hours for disk cache (much longer than in-memory 5 minutes)
const DISK_CACHE_TTL = 24 * 60 * 60 * 1000

// Maximum cache size (number of packages)
const MAX_CACHE_ENTRIES = 5000

// Cache file format version (increment when structure changes)
const CACHE_VERSION = 1

/**
 * Persistent cache manager for package registry data.
 * Stores cache on disk for fast repeated runs across CLI invocations.
 */
class PersistentCacheManager {
  private cacheDir: string
  private indexPath: string
  private index: CacheIndex | null = null
  private dirty = false

  constructor() {
    const paths = envPaths('inup')
    this.cacheDir = join(paths.cache, 'registry')
    this.indexPath = join(this.cacheDir, 'index.json')
  }

  /**
   * Ensure cache directory exists
   */
  private ensureCacheDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true })
    }
  }

  /**
   * Load cache index from disk
   */
  private loadIndex(): CacheIndex {
    if (this.index) {
      return this.index
    }

    try {
      if (existsSync(this.indexPath)) {
        const content = readFileSync(this.indexPath, 'utf-8')
        const parsed = JSON.parse(content) as CacheIndex

        // Check cache version - invalidate if outdated
        if (parsed.version !== CACHE_VERSION) {
          this.clearCache()
          this.index = { version: CACHE_VERSION, entries: {} }
          return this.index
        }

        this.index = parsed
        return this.index
      }
    } catch {
      // Corrupted index, start fresh
    }

    this.index = { version: CACHE_VERSION, entries: {} }
    return this.index
  }

  /**
   * Save cache index to disk
   */
  private saveIndex(): void {
    if (!this.dirty || !this.index) {
      return
    }

    try {
      this.ensureCacheDir()
      writeFileSync(this.indexPath, JSON.stringify(this.index), 'utf-8')
      this.dirty = false
    } catch {
      // Silently fail - cache is not critical
    }
  }

  /**
   * Generate a safe filename for a package name
   */
  private getFilename(packageName: string): string {
    // Handle scoped packages: @scope/name -> scope__name
    const safeName = packageName.replace(/^@/, '').replace(/\//g, '__')
    return `${safeName}.json`
  }

  /**
   * Get cached data for a package
   */
  get(packageName: string): { latestVersion: string; allVersions: string[] } | null {
    const index = this.loadIndex()
    const entry = index.entries[packageName]

    if (!entry) {
      return null
    }

    // Check TTL
    if (Date.now() - entry.timestamp > DISK_CACHE_TTL) {
      // Expired, remove from index
      delete index.entries[packageName]
      this.dirty = true
      return null
    }

    // Read the actual cache file
    try {
      const filePath = join(this.cacheDir, entry.file)
      if (!existsSync(filePath)) {
        delete index.entries[packageName]
        this.dirty = true
        return null
      }

      const content = readFileSync(filePath, 'utf-8')
      const cached = JSON.parse(content) as PackageCacheEntry

      return {
        latestVersion: cached.latestVersion,
        allVersions: cached.allVersions,
      }
    } catch {
      // Corrupted cache file, remove from index
      delete index.entries[packageName]
      this.dirty = true
      return null
    }
  }

  /**
   * Store data for a package
   */
  set(packageName: string, data: { latestVersion: string; allVersions: string[] }): void {
    const index = this.loadIndex()

    // Evict old entries if cache is too large
    const entryCount = Object.keys(index.entries).length
    if (entryCount >= MAX_CACHE_ENTRIES) {
      this.evictOldest(Math.floor(MAX_CACHE_ENTRIES * 0.1)) // Evict 10%
    }

    const filename = this.getFilename(packageName)
    const entry: PackageCacheEntry = {
      ...data,
      timestamp: Date.now(),
    }

    try {
      this.ensureCacheDir()
      const filePath = join(this.cacheDir, filename)
      writeFileSync(filePath, JSON.stringify(entry), 'utf-8')

      index.entries[packageName] = {
        file: filename,
        timestamp: Date.now(),
      }
      this.dirty = true
    } catch {
      // Silently fail - cache is not critical
    }
  }

  /**
   * Batch get multiple packages (returns map of found entries)
   */
  getMany(packageNames: string[]): Map<string, { latestVersion: string; allVersions: string[] }> {
    const results = new Map<string, { latestVersion: string; allVersions: string[] }>()

    for (const name of packageNames) {
      const cached = this.get(name)
      if (cached) {
        results.set(name, cached)
      }
    }

    return results
  }

  /**
   * Batch set multiple packages
   */
  setMany(entries: Map<string, { latestVersion: string; allVersions: string[] }>): void {
    for (const [name, data] of entries) {
      this.set(name, data)
    }
    this.flush()
  }

  /**
   * Evict oldest cache entries
   */
  private evictOldest(count: number): void {
    const index = this.loadIndex()
    const entries = Object.entries(index.entries)

    // Sort by timestamp (oldest first)
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp)

    // Remove oldest entries
    const toRemove = entries.slice(0, count)
    for (const [packageName, entry] of toRemove) {
      try {
        const filePath = join(this.cacheDir, entry.file)
        if (existsSync(filePath)) {
          unlinkSync(filePath)
        }
      } catch {
        // Ignore deletion errors
      }
      delete index.entries[packageName]
    }

    this.dirty = true
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    try {
      if (existsSync(this.cacheDir)) {
        const files = readdirSync(this.cacheDir)
        for (const file of files) {
          try {
            unlinkSync(join(this.cacheDir, file))
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore
    }

    this.index = { version: CACHE_VERSION, entries: {} }
    this.dirty = true
  }

  /**
   * Flush pending changes to disk
   */
  flush(): void {
    this.saveIndex()
  }

  /**
   * Get cache statistics
   */
  getStats(): { entries: number; cacheDir: string } {
    const index = this.loadIndex()
    return {
      entries: Object.keys(index.entries).length,
      cacheDir: this.cacheDir,
    }
  }
}

// Export singleton instance
export const persistentCache = new PersistentCacheManager()
