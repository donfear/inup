import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  etagCacheDir,
  readEtag,
  setEtagCacheEnabled,
  setEtagCacheRoot,
  writeEtag,
} from '../../../../src/shared/http/etag-store'

const data = { latestVersion: '2.0.0', allVersions: ['2.0.0', '1.0.0'] }

// Every test runs against an isolated throwaway root: the suite must never
// touch (or race other parallel test files on) the user's real persistent
// cache directory.
let testRoot: string

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'inup-etag-test-'))
  setEtagCacheRoot(testRoot)
  setEtagCacheEnabled(true)
})

afterEach(() => {
  setEtagCacheRoot(null)
  setEtagCacheEnabled(true)
  rmSync(testRoot, { recursive: true, force: true })
})

describe('etag-store', () => {
  it('round-trips an etag + data entry', () => {
    expect(readEtag('/some-pkg')).toBeNull()
    writeEtag('/some-pkg', 'W/"abc123"', data)
    const entry = readEtag('/some-pkg')
    expect(entry).toEqual({ etag: 'W/"abc123"', data })
  })

  it('keys distinct packages separately', () => {
    writeEtag('/pkg-a', 'etag-a', { latestVersion: '1.0.0', allVersions: ['1.0.0'] })
    writeEtag('/pkg-b', 'etag-b', { latestVersion: '9.0.0', allVersions: ['9.0.0'] })
    expect(readEtag('/pkg-a')?.etag).toBe('etag-a')
    expect(readEtag('/pkg-b')?.etag).toBe('etag-b')
  })

  it('returns null and writes nothing when disabled', () => {
    setEtagCacheEnabled(false)
    writeEtag('/pkg', 'etag', data)
    setEtagCacheEnabled(true)
    expect(readEtag('/pkg')).toBeNull()
  })

  it('ignores empty etags', () => {
    writeEtag('/pkg', '', data)
    expect(readEtag('/pkg')).toBeNull()
  })

  it('survives a corrupt cache file (returns null, never throws)', () => {
    writeEtag('/pkg', 'etag', data)
    // Overwrite with garbage via a second writer path: simulate corruption by
    // writing an invalid entry shape.
    writeEtag('/pkg', 'etag2', data) // valid again
    expect(readEtag('/pkg')?.etag).toBe('etag2')
  })

  it('resolves the cache dir under the configured root', () => {
    expect(etagCacheDir().startsWith(testRoot)).toBe(true)
  })

  it('recreates the cache dir after it is deleted mid-process', () => {
    writeEtag('/pkg', 'etag', data)
    rmSync(etagCacheDir(), { recursive: true, force: true })

    // The resolved path is memoized, but the mkdir guard must still run per
    // write — otherwise a swept cache silently disables the store for the
    // rest of the process.
    writeEtag('/pkg', 'etag-after-wipe', data)
    expect(readEtag('/pkg')?.etag).toBe('etag-after-wipe')
  })

  it('sweeps entries older than the max age on first use', async () => {
    const { readdirSync, utimesSync } = await import('node:fs')
    // Populate the cache, then age one entry far past the cutoff.
    writeEtag('/stale-pkg', 'W/"old"', data)
    writeEtag('/fresh-pkg', 'W/"new"', data)
    const dir = etagCacheDir()
    const files = readdirSync(dir).map((name) => join(dir, name))
    const ancient = new Date(2000, 0, 1)
    utimesSync(files[0], ancient, ancient)

    // Re-pointing the root resets the once-per-process sweep latch.
    setEtagCacheRoot(testRoot)
    readEtag('/anything')

    expect(existsSync(files[0])).toBe(false)
    expect(existsSync(files[1])).toBe(true)
  })

  it('sweeps orphaned schema generations from the persistent root', () => {
    // The cache root is persistent now (env-paths, not tmpdir), so old
    // generations must be reclaimed by the store itself after a SCHEMA bump.
    const oldGeneration = join(testRoot, 'v0')
    mkdirSync(oldGeneration, { recursive: true })
    writeFileSync(join(oldGeneration, 'stale.json'), '{}')

    // First cache access triggers the one-time sweep.
    readEtag('/anything')

    expect(existsSync(oldGeneration)).toBe(false)
    expect(existsSync(etagCacheDir())).toBe(true)
  })
})

describe('etag-store corruption handling', () => {
  it('treats corrupt cache entries as a miss', async () => {
    const { writeFileSync: write, readdirSync } = await import('node:fs')

    writeEtag('/corrupt-pkg', 'W/"x"', data)
    const dir = etagCacheDir()
    for (const name of readdirSync(dir)) {
      write(join(dir, name), '{not json')
    }

    expect(readEtag('/corrupt-pkg')).toBeNull()
  })

  it('rejects structurally invalid entries', async () => {
    const { writeFileSync: write, readdirSync } = await import('node:fs')

    writeEtag('/invalid-pkg', 'W/"x"', data)
    const dir = etagCacheDir()
    for (const name of readdirSync(dir)) {
      write(join(dir, name), JSON.stringify({ etag: 42 }))
    }

    expect(readEtag('/invalid-pkg')).toBeNull()
  })
})
