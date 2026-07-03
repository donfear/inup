import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import envPaths from 'env-paths'
import { PACKAGE_NAME } from '../config'
import type { PackageVersionData } from '../registry/npm-registry'

/**
 * On-disk ETag store for conditional registry requests.
 *
 * Same mechanism npm's own client uses (npm-registry-fetch → make-fetch-happen →
 * cacache): persist each response's ETag alongside the parsed data, then send
 * `If-None-Match` on the next run. When the packument is unchanged the registry
 * replies `304 Not Modified` with no body (~37ms vs downloading multiple MB), and
 * we reuse the stored data.
 *
 * FRESHNESS: this never serves stale data. Every run still issues a request; a
 * 304 is the registry *validating* that nothing changed. We skip the re-download,
 * never the network round-trip.
 *
 * Best-effort throughout: any read/write/parse failure is swallowed and the fetch
 * falls back to a normal unconditional request. A corrupt, missing, or
 * un-writable cache can never break a run or produce incorrect results.
 */

interface EtagEntry {
  etag: string
  data: PackageVersionData
}

/** Bump when the on-disk entry shape changes; old generations are ignored. */
const SCHEMA = 'v1'

/** Entries untouched for longer than this are swept on first access. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

let enabled = true
let sweptThisProcess = false
let cacheRootOverride: string | null = null
let resolvedSchemaDir: string | null = null

/** Allow tests/callers to toggle the store without touching call sites. */
export function setEtagCacheEnabled(value: boolean): void {
  enabled = value
}

/**
 * Test hook: point the store at an isolated root instead of the user's real
 * cache directory (null restores the default). Tests must never wipe or race
 * on the persistent per-user cache.
 */
export function setEtagCacheRoot(root: string | null): void {
  cacheRootOverride = root
  resolvedSchemaDir = null
  sweptThisProcess = false
}

/** The root holding one subdirectory per schema generation. */
function cacheRoot(): string {
  // Version data is not project-specific, so it lives in the per-user cache
  // directory (env-paths, like the config dir), shared across every project the
  // user scans. It used to live in the OS temp dir, but macOS clears that on
  // reboot and Linux distros sweep it periodically — throwing the cache away
  // exactly when it is most useful.
  return cacheRootOverride ?? join(envPaths(PACKAGE_NAME).cache, 'etag-cache')
}

/** Resolve (and lazily create) the cache directory, sweeping stale entries once. */
function cacheDir(): string {
  if (resolvedSchemaDir === null) {
    // The location is process-invariant; derive it once instead of running
    // env-paths on every cache read/write of the registry hot path.
    resolvedSchemaDir = join(cacheRoot(), SCHEMA)
  }
  const dir = resolvedSchemaDir
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  if (!sweptThisProcess) {
    sweptThisProcess = true
    sweepStale(dir)
    sweepOldGenerations(cacheRoot())
  }
  return dir
}

/** Delete entries not modified within MAX_AGE_MS. Best-effort, runs once. */
function sweepStale(dir: string): void {
  try {
    const cutoff = Date.now() - MAX_AGE_MS
    for (const name of readdirSync(dir)) {
      const file = join(dir, name)
      try {
        if (statSync(file).mtimeMs < cutoff) unlinkSync(file)
      } catch {
        /* skip files we can't stat/remove */
      }
    }
  } catch {
    /* sweeping is optional; never fail a run over it */
  }
}

/**
 * Remove schema generations other than the active one. The cache directory is
 * persistent (unlike the old tmpdir location, which the OS reclaimed), so after
 * a SCHEMA bump the previous generation would otherwise live on disk forever.
 */
function sweepOldGenerations(root: string): void {
  try {
    for (const name of readdirSync(root)) {
      if (name === SCHEMA) continue
      try {
        rmSync(join(root, name), { recursive: true, force: true })
      } catch {
        /* skip generations we can't remove */
      }
    }
  } catch {
    /* sweeping is optional; never fail a run over it */
  }
}

/** Stable, filesystem-safe filename for a cache key (the registry path). */
function fileFor(key: string): string {
  const hash = createHash('sha1').update(key).digest('hex')
  return join(cacheDir(), `${hash}.json`)
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

/** Test/maintenance helper: the resolved cache directory. */
export function etagCacheDir(): string {
  return cacheDir()
}
