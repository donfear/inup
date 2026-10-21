import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  etagCacheDir,
  etagFileFor,
  readEtag,
  readFresh,
  renewEtag,
  responseFreshness,
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

  it('resolves entry files that a writer outside the store can fill in', () => {
    const file = etagFileFor('/pkg')
    expect(file?.startsWith(etagCacheDir())).toBe(true)
    expect(etagFileFor('/pkg')).toBe(file)
    expect(etagFileFor('/other-pkg')).not.toBe(file)

    writeFileSync(file as string, JSON.stringify({ etag: 'W/"ext"', data }))
    expect(readEtag('/pkg')).toEqual({ etag: 'W/"ext"', data })
  })

  it('has no entry file when disabled or when the cache dir cannot be created', () => {
    setEtagCacheEnabled(false)
    expect(etagFileFor('/pkg')).toBeNull()
    setEtagCacheEnabled(true)

    const blocker = join(testRoot, 'not-a-dir')
    writeFileSync(blocker, '')
    setEtagCacheRoot(blocker)
    expect(etagFileFor('/pkg')).toBeNull()
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

describe('etag-store freshness', () => {
  const now = Date.now()

  it.each([
    // [cache-control, age, ttl or null] — the same table as response_freshness
    // in native/core/src/lib.rs, so both transports store the same entries.
    ['public, max-age=300', '131', 169],
    ['public, max-age=300', undefined, 300],
    ['max-age=60', ' 0 ', 60],
    ['PUBLIC, MAX-AGE = 120', undefined, 120],
    ['max-age=86400', '100', 200],
    ['max-age=99999999999999999999999', undefined, 300],
    ['max-age=300, max-age=30', undefined, 30],
    ['max-age=300,max-age=30', '10', 20],
    ['public, max-age=300', '300', null],
    ['public, max-age=300', '301', null],
    ['public, max-age=300', '99999999999999999999999', null],
    ['public, max-age=300', '-1', null],
    ['public, max-age=300', '', null],
    ['public, max-age=300', '1.5', null],
    ['max-age=0', undefined, null],
    ['max-age="300"', undefined, null],
    ['max-age=30x', undefined, null],
    ['max-age', undefined, null],
    ['max-age=', undefined, null],
    ['max-age=30=0', undefined, null],
    ['public', undefined, null],
    ['', undefined, null],
    [undefined, undefined, null],
    ['no-cache, max-age=300', undefined, null],
    ['max-age=300, no-store', undefined, null],
    ['private, max-age=300', undefined, null],
    ['max-age=300, private="set-cookie"', undefined, null],
    ['max-age=300, No-Cache', undefined, null],
    ['s-maxage=300', undefined, null],
    ['public, s-maxage=600, max-age=300, must-revalidate', '5', 295],
  ])('cache-control %j with age %j grants a ttl of %j', (cacheControl, age, ttl) => {
    expect(responseFreshness(cacheControl, age, now)).toEqual(
      ttl === null ? null : { fetchedAt: now, ttl }
    )
  })

  it('reads repeated headers the way Node delivers them', () => {
    expect(responseFreshness(['public', 'max-age=300'], ['20', '99'], now)).toEqual({
      fetchedAt: now,
      ttl: 280,
    })
  })

  it('stores the freshness fields after the data, and nothing without them', () => {
    writeEtag('/fresh', 'W/"1"', data, { fetchedAt: 1_760_000_000_123, ttl: 169 })
    writeEtag('/plain', 'W/"2"', data, null)
    expect(readFileSync(etagFileFor('/fresh') as string, 'utf8')).toBe(
      JSON.stringify({ etag: 'W/"1"', data, fetchedAt: 1_760_000_000_123, ttl: 169 })
    )
    expect(readFileSync(etagFileFor('/plain') as string, 'utf8')).toBe(
      JSON.stringify({ etag: 'W/"2"', data })
    )
    expect(readEtag('/fresh')).toEqual({
      etag: 'W/"1"',
      data,
      fetchedAt: 1_760_000_000_123,
      ttl: 169,
    })
  })

  it('serves an entry until its ttl runs out', () => {
    writeEtag('/pkg', 'W/"1"', data, { fetchedAt: now, ttl: 169 })
    expect(readFresh('/pkg', now)).toEqual(data)
    expect(readFresh('/pkg', now + 168_999)).toEqual(data)
    expect(readFresh('/pkg', now + 169_000)).toBeNull()
  })

  it('treats an entry from the future as stale: the clock went backwards', () => {
    writeEtag('/pkg', 'W/"1"', data, { fetchedAt: now + 60_000, ttl: 300 })
    expect(readFresh('/pkg', now)).toBeNull()
  })

  it('caps a stored ttl at 5 minutes', () => {
    writeEtag('/pkg', 'W/"1"', data, { fetchedAt: now - 301_000, ttl: 3600 })
    expect(readFresh('/pkg', now)).toBeNull()
  })

  it('never serves entries without valid freshness fields', () => {
    writeEtag('/old-format', 'W/"1"', data)
    writeFileSync(
      etagFileFor('/bad-fields') as string,
      JSON.stringify({ etag: 'W/"1"', data, fetchedAt: String(now), ttl: '300' })
    )
    writeFileSync(etagFileFor('/bad-shape') as string, JSON.stringify({ etag: 1, data }))
    writeFileSync(etagFileFor('/corrupt') as string, '{not json')

    for (const key of ['/old-format', '/bad-fields', '/bad-shape', '/corrupt', '/missing']) {
      expect(readFresh(key, now)).toBeNull()
    }
  })

  it('skips reading a file untouched for longer than the cap', () => {
    // The JSON claims freshness, but a write would have touched the file.
    writeEtag('/pkg', 'W/"1"', data, { fetchedAt: now, ttl: 300 })
    const longAgo = new Date(now - 10 * 60_000)
    utimesSync(etagFileFor('/pkg') as string, longAgo, longAgo)
    expect(readFresh('/pkg', now)).toBeNull()
  })

  it('serves nothing when the store is disabled', () => {
    writeEtag('/pkg', 'W/"1"', data, { fetchedAt: now, ttl: 300 })
    setEtagCacheEnabled(false)
    expect(readFresh('/pkg', now)).toBeNull()
  })

  it('renews an entry with new freshness, keeping its etag and data', async () => {
    writeEtag('/pkg', 'W/"1"', data, { fetchedAt: now - 400_000, ttl: 300 })
    expect(readFresh('/pkg')).toBeNull()

    await renewEtag('/pkg', { etag: 'W/"1"', data }, { fetchedAt: now, ttl: 250 })

    expect(readEtag('/pkg')).toEqual({ etag: 'W/"1"', data, fetchedAt: now, ttl: 250 })
    expect(readFresh('/pkg', now + 1000)).toEqual(data)
    // Written through a temp file renamed over the entry, which leaves nothing behind.
    expect(readdirSync(etagCacheDir()).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('removes its temp file when the entry cannot be replaced', async () => {
    const file = etagFileFor('/pkg') as string
    // rename refuses to put a file over a directory.
    mkdirSync(file)

    await expect(
      renewEtag('/pkg', { etag: 'W/"1"', data }, { fetchedAt: now, ttl: 250 })
    ).resolves.toBeUndefined()

    expect(readdirSync(etagCacheDir()).sort()).toEqual([basename(file)])
    expect(readFresh('/pkg', now)).toBeNull()
  })

  it('renews nothing when disabled and never rejects on an unusable directory', async () => {
    setEtagCacheEnabled(false)
    await renewEtag('/pkg', { etag: 'W/"1"', data }, { fetchedAt: now, ttl: 250 })
    setEtagCacheEnabled(true)
    expect(readEtag('/pkg')).toBeNull()

    const blocker = join(testRoot, 'not-a-dir')
    writeFileSync(blocker, '')
    setEtagCacheRoot(blocker)
    await expect(
      renewEtag('/pkg', { etag: 'W/"1"', data }, { fetchedAt: now, ttl: 250 })
    ).resolves.toBeUndefined()
    expect(readFresh('/pkg', now)).toBeNull()
  })
})
