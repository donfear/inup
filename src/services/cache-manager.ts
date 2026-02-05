import { CACHE_TTL } from '../config'
import { persistentCache } from './persistent-cache'

/**
 * Package version data structure
 */
export interface PackageVersionData {
  latestVersion: string
  allVersions: string[]
}

/**
 * In-memory cache entry with timestamp for TTL
 */
interface CacheEntry<T> {
  data: T
  timestamp: number
}

/**
 * Unified cache manager that handles both in-memory and persistent disk caching.
 * Consolidates caching logic used across registry services.
 */
export class CacheManager<T = PackageVersionData> {
  private memoryCache = new Map<string, CacheEntry<T>>()
  private ttl: number

  constructor(ttl: number = CACHE_TTL) {
    this.ttl = ttl
  }

  /**
   * Get cached data for a key, checking memory first, then disk.
   * Returns null if not found or expired.
   */
  get(key: string): T | null {
    // Check in-memory cache first (fastest)
    const memoryCached = this.memoryCache.get(key)
    if (memoryCached && Date.now() - memoryCached.timestamp < this.ttl) {
      return memoryCached.data
    }

    // Check persistent disk cache (survives restarts)
    const diskCached = persistentCache.get(key)
    if (diskCached) {
      // Populate in-memory cache for subsequent accesses
      this.memoryCache.set(key, {
        data: diskCached as T,
        timestamp: Date.now(),
      })
      return diskCached as T
    }

    return null
  }

  /**
   * Store data in both memory and disk cache.
   */
  set(key: string, data: T): void {
    // Cache in memory
    this.memoryCache.set(key, {
      data,
      timestamp: Date.now(),
    })

    // Cache to disk for persistence
    persistentCache.set(key, data as PackageVersionData)
  }

  /**
   * Get data from cache or fetch it using the provided fetcher function.
   * This is the main entry point for cache-aside pattern.
   */
  async getOrFetch(key: string, fetcher: () => Promise<T | null>): Promise<T | null> {
    // Try cache first
    const cached = this.get(key)
    if (cached) {
      return cached
    }

    // Fetch fresh data
    const data = await fetcher()
    if (data) {
      this.set(key, data)
    }

    return data
  }

  /**
   * Check if a key exists and is not expired in cache.
   */
  has(key: string): boolean {
    return this.get(key) !== null
  }

  /**
   * Clear in-memory cache (useful for testing).
   */
  clear(): void {
    this.memoryCache.clear()
  }

  /**
   * Flush pending disk cache writes.
   */
  flush(): void {
    persistentCache.flush()
  }

  /**
   * Get cache statistics.
   */
  getStats(): { memoryEntries: number; diskStats: { entries: number; cacheDir: string } } {
    return {
      memoryEntries: this.memoryCache.size,
      diskStats: persistentCache.getStats(),
    }
  }
}

// Default package version cache instance
export const packageCache = new CacheManager<PackageVersionData>()
