import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PackageVersionData } from '../npm-registry'

/**
 * On-disk ETag store for conditional registry requests.
 *
 * This is the same mechanism npm's own client uses (npm-registry-fetch →
 * make-fetch-happen → cacache): persist each response's ETag alongside the parsed
 * data, then send `If-None-Match` on the next run. When the packument is
 * unchanged the registry replies `304 Not Modified` with no body (~37ms vs
 * downloading multiple MB), and we reuse the stored data.
 *
 * FRESHNESS: this does NOT serve stale data. Every run still issues a request to
 * the registry; a 304 is the registry *validating* that nothing changed. We never
 * skip the network — we only skip the re-download when the registry confirms the
 * data is current.
 *
 * Best-effort: any read/write/parse failure is swallowed and the fetch falls back
 * to a normal unconditional request. A corrupt or missing cache can never break a
 * run or cause incorrect results.
 */

interface EtagEntry {
  etag: string
  data: PackageVersionData
}

const SCHEMA = 'v1'

function cacheDir(): string {
  // Version data is not project-specific, so it lives in the OS cache/temp area,
  // shared across every project the user scans.
  const dir = join(tmpdir(), 'inup', 'etag-cache', SCHEMA)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** Stable, filesystem-safe filename for a cache key (the registry path). */
function fileFor(key: string): string {
  const hash = createHash('sha1').update(key).digest('hex')
  return join(cacheDir(), `${hash}.json`)
}

let enabled = true

/** Allow tests / callers to disable the store without touching the call sites. */
export function setEtagCacheEnabled(value: boolean): void {
  enabled = value
}

export function isEtagCacheEnabled(): boolean {
  return enabled
}

/** Read a stored entry, or null if absent/unreadable/disabled. */
export function readEtag(key: string): EtagEntry | null {
  if (!enabled) return null
  try {
    const file = fileFor(key)
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as EtagEntry
    if (!parsed || typeof parsed.etag !== 'string' || !parsed.data) return null
    return parsed
  } catch {
    return null
  }
}

/** Persist an entry. Best-effort; failures are ignored. */
export function writeEtag(key: string, etag: string, data: PackageVersionData): void {
  if (!enabled || !etag) return
  try {
    writeFileSync(fileFor(key), JSON.stringify({ etag, data }))
  } catch {
    /* best-effort */
  }
}

/** Test/maintenance helper. */
export function etagCacheDir(): string {
  return cacheDir()
}
