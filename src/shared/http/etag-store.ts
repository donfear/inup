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
import { writeFile } from 'node:fs/promises'
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
 * FRESHNESS: data can be up to max-age old. An entry also records how long the
 * registry said its response may be reused (`Cache-Control: max-age` minus `Age`,
 * with max-age capped at 5 minutes). Until that runs out, a lookup is answered
 * from the entry with no request at all; after it, the next run revalidates as
 * above and a 304 renews it. That is the same bound the registry's CDN already
 * serves within (npm sends `max-age=300`), so a version published moments ago
 * can take up to 5 minutes to show up. Responses marked `no-cache`, `no-store`
 * or `private`, or without a max-age, are revalidated on every run as before.
 *
 * Best-effort throughout: any read/write/parse failure is swallowed and the fetch
 * falls back to a normal unconditional request. A corrupt, missing, or
 * un-writable cache can never break a run or produce incorrect results.
 */

/** How long a response may be reused without asking the registry again. */
export interface Freshness {
  /** When the request was sent, in ms since the epoch. */
  fetchedAt: number
  /** Seconds after `fetchedAt` the response stays fresh: max-age minus Age. */
  ttl: number
}

/** Freshness fields are optional: entries without them are always revalidated. */
interface EtagEntry extends Partial<Freshness> {
  etag: string
  data: PackageVersionData
}

/** Upper bound on max-age, whatever a registry sends; npm's own is 5 minutes. */
const MAX_TTL_SECONDS = 300

/** Bump when the on-disk entry shape changes; old generations are ignored. */
const SCHEMA = 'v2' // v2: PackageVersionData gained prereleaseVersions

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

/**
 * The freshness a response grants, from its Cache-Control and Age headers, or
 * null when it must be revalidated on every run: no max-age, a `no-cache`,
 * `no-store` or `private` directive (with or without a field list), an
 * unparseable max-age or Age, or an Age that already used up the max-age.
 * Several max-age values (repeated headers) count as the smallest.
 *
 * Mirrors `response_freshness` in native/core/src/lib.rs: both transports must
 * store the same entry for the same headers.
 */
export function responseFreshness(
  cacheControl: string | string[] | undefined,
  age: string | string[] | undefined,
  fetchedAt: number
): Freshness | null {
  const header = Array.isArray(cacheControl) ? cacheControl.join(',') : (cacheControl ?? '')
  let maxAge: number | null = null
  for (const directive of header.split(',')) {
    const eq = directive.indexOf('=')
    const name = (eq < 0 ? directive : directive.slice(0, eq)).trim().toLowerCase()
    if (name === 'no-cache' || name === 'no-store' || name === 'private') return null
    if (name !== 'max-age') continue
    const seconds = parseSeconds(eq < 0 ? undefined : directive.slice(eq + 1).trim())
    if (seconds === null) return null
    maxAge = Math.min(maxAge ?? seconds, seconds)
  }
  if (maxAge === null) return null
  const ageValue = Array.isArray(age) ? age[0] : age
  const ageSeconds = ageValue === undefined ? 0 : parseSeconds(ageValue.trim())
  if (ageSeconds === null) return null
  const ttl = Math.min(maxAge, MAX_TTL_SECONDS) - ageSeconds
  return ttl > 0 ? { fetchedAt, ttl } : null
}

/** A delta-seconds value (RFC 9111): one or more ASCII digits, nothing else. */
function parseSeconds(value: string | undefined): number | null {
  return value !== undefined && /^[0-9]+$/.test(value) ? Number(value) : null
}

/** Whether an entry's freshness still holds at `now`. */
function isFresh({ fetchedAt, ttl }: EtagEntry, now: number): boolean {
  if (typeof fetchedAt !== 'number' || typeof ttl !== 'number') return false
  // A clock that went backwards (now before fetchedAt) makes an entry stale,
  // and the cap applies again in case an entry carries a longer ttl.
  const elapsed = now - fetchedAt
  return elapsed >= 0 && elapsed < Math.min(ttl, MAX_TTL_SECONDS) * 1000
}

/**
 * The stored data for `key` while its response is still fresh, else null.
 * A fresh entry needs no request at all, not even a conditional one.
 */
export function readFresh(key: string, now = Date.now()): PackageVersionData | null {
  if (!enabled) return null
  try {
    // Every write sets the file's mtime, and the response it holds is never
    // newer than that, so a file untouched for longer than the cap cannot be
    // fresh: a stat skips reading and parsing it (the usual case on a later run).
    const file = fileFor(key)
    const stats = statSync(file, { throwIfNoEntry: false })
    if (!stats || stats.mtimeMs < now - MAX_TTL_SECONDS * 1000) return null
    const entry = parseEntry(file)
    return entry && isFresh(entry, now) ? entry.data : null
  } catch {
    return null
  }
}

/** Read a stored entry, or null if absent/unreadable/disabled. */
export function readEtag(key: string): EtagEntry | null {
  if (!enabled) return null
  try {
    const file = fileFor(key)
    if (!existsSync(file)) return null
    return parseEntry(file)
  } catch {
    return null
  }
}

/** The entry stored in `file`, or null when its shape is wrong. Throws on I/O or JSON errors. */
function parseEntry(file: string): EtagEntry | null {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as EtagEntry
  if (!parsed || typeof parsed.etag !== 'string' || !parsed.data) return null
  return parsed
}

/**
 * The file an entry for `key` lives in, or null when the store is disabled or
 * the directory is unusable. Lets the optional Rust core write the entry off
 * the main thread; its content must match writeEtag's JSON.
 */
export function etagFileFor(key: string): string | null {
  if (!enabled) return null
  try {
    return fileFor(key)
  } catch {
    return null
  }
}

/** The JSON of an entry; the freshness fields only when the response granted any. */
function entryJson(etag: string, data: PackageVersionData, freshness: Freshness | null): string {
  return JSON.stringify(
    freshness ? { etag, data, fetchedAt: freshness.fetchedAt, ttl: freshness.ttl } : { etag, data }
  )
}

/** Persist an entry. Best-effort; failures are ignored. */
export function writeEtag(
  key: string,
  etag: string,
  data: PackageVersionData,
  freshness: Freshness | null = null
): void {
  if (!enabled || !etag) return
  try {
    writeFileSync(fileFor(key), entryJson(etag, data, freshness))
  } catch {
    /* best-effort */
  }
}

/**
 * Renew the freshness of an entry the registry just confirmed with a 304. The
 * data is unchanged, so the write goes off the main thread and nothing waits
 * for it. Best-effort; never rejects.
 */
export async function renewEtag(
  key: string,
  entry: { etag: string; data: PackageVersionData },
  freshness: Freshness
): Promise<void> {
  if (!enabled) return
  try {
    await writeFile(fileFor(key), entryJson(entry.etag, entry.data, freshness))
  } catch {
    /* best-effort */
  }
}

/** Test/maintenance helper: the resolved cache directory. */
export function etagCacheDir(): string {
  return cacheDir()
}
