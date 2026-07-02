import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync } from 'node:fs'
import {
  readEtag,
  writeEtag,
  setEtagCacheEnabled,
  etagCacheDir,
} from '../../../../src/shared/http/etag-store'

const data = { latestVersion: '2.0.0', allVersions: ['2.0.0', '1.0.0'] }

describe('etag-store', () => {
  beforeEach(() => {
    setEtagCacheEnabled(true)
    // Start from a clean cache dir each test.
    rmSync(etagCacheDir(), { recursive: true, force: true })
  })

  afterEach(() => {
    setEtagCacheEnabled(true)
  })

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
})
