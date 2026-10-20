import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { brotliDecompress, gunzip, inflate } from 'node:zlib'

const gunzipAsync = promisify(gunzip)
const inflateAsync = promisify(inflate)
const brotliDecompressAsync = promisify(brotliDecompress)

import { POOL_CONNECTIONS, PROBE_CONNECTIONS } from '../config'
import { debugLog } from '../debug-logger'
import { etagFileFor, hasEtag, moveEtag, readEtag, removeEtag, writeEtag } from '../http/etag-store'
import { type ControlTick, HillClimbController } from '../http/hill-climb-controller'
import { httpRequest } from '../http/http-request'
import { InflightMap } from '../http/inflight'
import { ResizableSemaphore } from '../http/resizable-semaphore'
import { isCongestionStatus, isRetryableStatus, parseRetryAfterMs, sleep } from '../http/retry'
import { extractEnginesNode, normalizeDeprecatedMessage } from '../manifest'
import { clamp } from '../math'
import { stripControlCharacters } from '../terminal/text'
import type { FetchPackageVersionsOptions, OnPackageReadyCallback } from '../types'
import { type ParsedVersions, parseVersions } from '../versions'
import { type RegistryTarget, registryTargetFor } from './registry-config'
import {
  type NativeTransport,
  nativeTransport,
  type PackumentDecodeRequest,
  packumentDecoder,
  type RawParsed,
  toParsedVersions,
} from './rust-core'

// Aliased so the registry payload can never drift from what parseVersions emits.
export type PackageVersionData = ParsedVersions

const inFlightLookups = new InflightMap<PackageVersionData>()

// Time allowed until a registry response's headers arrive. A stalled connection
// that never answers would otherwise stay invisible to the completion-based
// adaptive controller; with the timeout it surfaces as a transient error the
// controller reacts to and the retry loop handles. Bodies have no timeout.
const HEADERS_TIMEOUT_MS = 30_000

const MAX_REGISTRY_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [500, 1500, 3000]

async function getFreshPackageData(
  packageName: string,
  currentVersion: string | undefined,
  fullMetadata: boolean,
  probed: ProbedEntry | null,
  onAttempt?: AttemptObserver,
  onChunk?: OnChunk,
  signal?: AbortSignal
): Promise<PackageVersionData> {
  // A cancellable run owns its request; cancelling it must not abort another
  // caller's deduplicated lookup of the same package.
  if (signal) {
    return fetchPackageFromRegistry(packageName, fullMetadata, probed, onAttempt, onChunk, signal)
  }
  // Abbreviated and full responses parse to different shapes, and a probe's
  // entry knows only the latest version, so none of them may share an in-flight
  // entry.
  const cacheKey = `${packageName}@${currentVersion ?? ''}${probed ? '#latest' : ''}${fullMetadata ? '#full' : ''}`
  return inFlightLookups.dedupe(cacheKey, () =>
    fetchPackageFromRegistry(packageName, fullMetadata, probed, onAttempt, onChunk)
  )
}

const encodeRegistryPath = (packageName: string, pathPrefix: string): string => {
  const encodedName = packageName.startsWith('@')
    ? `@${encodeURIComponent(packageName.slice(1).split('/')[0])}/${encodeURIComponent(
        packageName.slice(packageName.indexOf('/') + 1)
      )}`
    : encodeURIComponent(packageName)
  return `${pathPrefix}/${encodedName}`
}

type RegistryAttemptOutcome =
  | {
      kind: 'success'
      data: PackageVersionData
      latencyMs: number
      revalidated: boolean
      /** Compressed body bytes received (0 for a 304). */
      bytes: number
    }
  | { kind: 'not-found' }
  /** 401/403: the registry refused the request. Final like not-found, but reported. */
  | { kind: 'denied'; origin: string; status: number }
  | { kind: 'retryable' }
  | { kind: 'congested'; retryAfterMs: number | null }
  | { kind: 'transient' }

/**
 * Observes the outcome of each single attempt so the adaptive controller can see
 * congestion, errors, and success latency. Latency is reported ONLY for
 * successful single attempts — never including retry backoff — so the EWMA stays
 * a clean signal of true round-trip time.
 */
export type AttemptObserver = (outcome: RegistryAttemptOutcome) => void

/** Called with each body chunk's byte length as it arrives. */
type OnChunk = (bytes: number) => void

/** A package lookup the registry refused (401/403). */
export interface RegistryAccessDenial {
  packageName: string
  /** Registry origin only: never a path, credentials or the auth header. */
  origin: string
  status: number
}

/**
 * A final non-2xx answer. 401/403 mean the registry refused the credentials (or
 * their absence), which is not the same as the package not existing: an expired
 * token must not pass for a missing package.
 */
const finalFailure = (origin: string, status: number): RegistryAttemptOutcome =>
  status === 401 || status === 403 ? { kind: 'denied', origin, status } : { kind: 'not-found' }

/**
 * Read a response body to a Buffer chunk by chunk, so the caller can account
 * bytes as they arrive (the adaptive controller measures cold windows in
 * bytes/sec).
 */
async function readBody(body: AsyncIterable<Uint8Array>, onChunk?: OnChunk): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of body) {
    onChunk?.(chunk.length)
    chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
  }
  return Buffer.concat(chunks)
}

/** A response header's first value, as text. */
function headerText(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value)?.toString()
}

/** Request headers for the registry, with its credentials. */
function registryHeaders(target: RegistryTarget, accept: string): Record<string, string> {
  const headers: Record<string, string> = { accept, 'accept-encoding': 'gzip, deflate, br' }
  if (target.authHeader) headers.authorization = target.authHeader
  return headers
}

/** Decompress a response body according to its content-encoding. */
async function decompressBody(raw: Buffer, encoding: string | undefined): Promise<Buffer> {
  if (encoding === 'gzip') return gunzipAsync(raw)
  if (encoding === 'br') return brotliDecompressAsync(raw)
  if (encoding === 'deflate') return inflateAsync(raw)
  return raw
}

/**
 * Turn a 200 body into version data and persist its ETag entry for the next
 * run's conditional request. Uses the Rust core when one is loaded; if it
 * fails, the TypeScript path handles the body.
 *
 * The Rust decoder reads only the fields of the abbreviated document and drops
 * `time`, so a full-packument body is always decoded in TypeScript — otherwise
 * the publish times the release-age policy needs would vanish silently.
 */
async function decodePackument(
  raw: Buffer,
  encoding: string | undefined,
  cacheKey: string,
  etag: string | undefined,
  fullMetadata: boolean
): Promise<PackageVersionData> {
  const rustDecode = fullMetadata ? null : packumentDecoder()
  if (rustDecode) {
    let cache: PackumentDecodeRequest['cache'] = null
    if (etag) {
      const file = etagFileFor(cacheKey)
      if (file) cache = { file, etag }
    }
    try {
      return await rustDecode({ raw, encoding: encoding ?? '', cache })
    } catch (error) {
      debugLog.warn('npm-registry', 'Rust decoder failed, falling back to TypeScript', error)
    }
  }
  const data = parseVersions((await decompressBody(raw, encoding)).toString('utf8'))
  if (etag) {
    writeEtag(cacheKey, etag, data)
  }
  return data
}

// Origins where the native transport failed in a way Node's own stack might not
// (TLS trust, an internal error): the rest of this run uses the JS transport.
const jsOnlyOrigins = new Set<string>()

/** The native transport for an origin, or null to use the JS transport. */
function nativeTransportFor(origin: string): NativeTransport | null {
  if (jsOnlyOrigins.has(origin)) return null
  return nativeTransport()
}

/**
 * One registry attempt through the native transport. Resolves to null when the
 * attempt should be redone with the JS transport (the origin is then pinned to it).
 */
async function attemptNative(
  transport: NativeTransport,
  target: RegistryTarget,
  path: string,
  cacheKey: string,
  signal?: AbortSignal
): Promise<RegistryAttemptOutcome | null> {
  const result = await transport.fetch(
    {
      url: `${target.origin}${path}`,
      authorization: target.authHeader,
      cacheFile: etagFileFor(cacheKey),
    },
    signal
  )
  const latencyMs = Math.round(result.latencyMs)
  switch (result.kind) {
    case 'success':
      // A success always carries data; the guard only satisfies the types.
      /* v8 ignore next */
      if (!result.dataJson) return { kind: 'transient' }
      return {
        kind: 'success',
        data: toParsedVersions(JSON.parse(result.dataJson) as RawParsed),
        latencyMs,
        revalidated: result.revalidated,
        bytes: result.bytes,
      }
    case 'not-found':
      return finalFailure(target.origin, result.status)
    case 'retryable':
      return { kind: 'retryable' }
    case 'congested':
      return { kind: 'congested', retryAfterMs: parseRetryAfterMs(result.retryAfter ?? undefined) }
    case 'transient':
      return { kind: 'transient' }
    case 'cancelled':
      signal?.throwIfAborted()
      return { kind: 'transient' }
    default:
      jsOnlyOrigins.add(target.origin)
      debugLog.warn(
        'npm-registry',
        `native transport unavailable for ${target.origin} (${result.errorClass}), using the JS transport`,
        result.error
      )
      return null
  }
}

async function attemptRegistryFetch(
  target: RegistryTarget,
  path: string,
  fullMetadata: boolean,
  cacheKey: string,
  onChunk?: OnChunk,
  signal?: AbortSignal
): Promise<RegistryAttemptOutcome> {
  // The native transport asks for — and its decoder keeps — only the abbreviated
  // document, which carries no `time`. A run that needs publish times takes the
  // JS path instead of silently losing the field the policy depends on.
  const transport = fullMetadata ? null : nativeTransportFor(target.origin)
  if (transport) {
    const outcome = await attemptNative(transport, target, path, cacheKey, signal)
    if (outcome) return outcome
  }
  return attemptWithNodeHttp(target, path, fullMetadata, cacheKey, onChunk, signal)
}

/**
 * The ETag cache key of a version list. Keys are origin-qualified so two
 * registries can never collide on a path. Full-packument responses parse to
 * richer data (publish times), so they get their own entry — a 304 must never
 * revive an abbreviated-format body.
 */
function listCacheKey(target: RegistryTarget, path: string, fullMetadata: boolean): string {
  return `${target.origin}${path}${fullMetadata ? '#full' : ''}`
}

async function attemptWithNodeHttp(
  target: RegistryTarget,
  path: string,
  fullMetadata: boolean,
  cacheKey: string,
  onChunk?: OnChunk,
  signal?: AbortSignal
): Promise<RegistryAttemptOutcome> {
  const startedAt = Date.now()
  // Conditional request: if we have a stored ETag for this packument, ask the
  // registry to validate it. Unchanged → 304 (no body) and we reuse stored data.
  // This still hits the registry every run, so data is never served stale.
  const cached = readEtag(cacheKey)
  try {
    const requestHeaders = registryHeaders(
      target,
      // The abbreviated install-v1 format is much smaller but has no `time` field;
      // release-age policies need publish times, hence the full packument.
      fullMetadata ? 'application/json' : 'application/vnd.npm.install-v1+json'
    )
    if (cached) {
      requestHeaders['if-none-match'] = cached.etag
    }

    const { statusCode, headers, body } = await httpRequest(target.origin, {
      path,
      headers: requestHeaders,
      headersTimeoutMs: HEADERS_TIMEOUT_MS,
      signal,
    })

    // Registry confirmed our cached copy is current — reuse it, skip the download.
    if (statusCode === 304 && cached) {
      await body.dump().catch(() => undefined)
      return {
        kind: 'success',
        data: cached.data,
        latencyMs: Date.now() - startedAt,
        revalidated: true,
        bytes: 0,
      }
    }

    if (statusCode < 200 || statusCode >= 300) {
      await body.dump().catch(() => undefined)
      if (isCongestionStatus(statusCode)) {
        return {
          kind: 'congested',
          retryAfterMs: parseRetryAfterMs(headers['retry-after']),
        }
      }
      if (isRetryableStatus(statusCode)) {
        return { kind: 'retryable' }
      }
      return finalFailure(target.origin, statusCode)
    }

    const raw = await readBody(body, onChunk)
    const encoding = headerText(headers['content-encoding'])?.toLowerCase()
    const etag = headerText(headers.etag)
    const data = await decodePackument(raw, encoding, cacheKey, etag, fullMetadata)

    return {
      kind: 'success',
      data,
      latencyMs: Date.now() - startedAt,
      revalidated: false,
      bytes: raw.length,
    }
  } catch {
    signal?.throwIfAborted()
    // Every network failure is treated as transient, known or not, so we try
    // the fallback rather than silently returning 'unknown'.
    return { kind: 'transient' }
  }
}

async function fetchFromRegistryWithRetries(
  target: RegistryTarget,
  path: string,
  fullMetadata: boolean,
  cacheKey: string,
  onAttempt?: AttemptObserver,
  onChunk?: OnChunk,
  signal?: AbortSignal
): Promise<RegistryAttemptOutcome> {
  let lastOutcome: RegistryAttemptOutcome = { kind: 'transient' }
  for (let attempt = 0; attempt < MAX_REGISTRY_ATTEMPTS; attempt++) {
    signal?.throwIfAborted()
    const outcome = await attemptRegistryFetch(
      target,
      path,
      fullMetadata,
      cacheKey,
      onChunk,
      signal
    )
    onAttempt?.(outcome)
    if (outcome.kind === 'success' || outcome.kind === 'not-found' || outcome.kind === 'denied') {
      return outcome
    }
    lastOutcome = outcome
    if (attempt < MAX_REGISTRY_ATTEMPTS - 1) {
      // Honor Retry-After on congestion; otherwise exponential backoff. These
      // sleeps are deliberately NOT timed into the controller's latency EWMA.
      const congestedWait =
        outcome.kind === 'congested' && outcome.retryAfterMs !== null ? outcome.retryAfterMs : null
      const backoff =
        congestedWait ?? RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]
      if (signal) await delay(backoff, undefined, { signal })
      else await sleep(backoff)
    }
  }
  return lastOutcome
}

// --- the `latest` probe ------------------------------------------------------
//
// A package already on its latest version needs nothing from its version list,
// which can run to megabytes: GET /<name>/latest answers with that one version's
// document, a few KB. Used where nothing is cached yet (a cold run): a cached
// list costs a header-sized 304 while it is unchanged.
//
// `latest` documents carry no ETag, and the public registry's CDN rarely holds
// them (a miss costs a few hundred ms), so a later run must not probe again.
// After a probe finds the package current, a HEAD fetches the version list's
// ETag, which is stored with the probe's data under its own key (see
// probedCacheKey). The next run revalidates the list against it: a 304 means
// the package is still current, exactly as with a cached list.

/** Answers before the probe's yield is judged, and the share that must be current. */
const PROBE_YIELD_SAMPLE = 24
const PROBE_YIELD_MIN_CURRENT = 1 / 3

/** What a `latest` probe learned. */
type LatestProbe =
  /** The registry's latest is the declared version: the package's whole answer. */
  | { kind: 'current'; data: PackageVersionData; latencyMs: number }
  /**
   * Another version, or no version document at all (a refusal, a registry
   * without the endpoint): the version list is needed.
   */
  | { kind: 'other' }
  /** A server error or a network error: says nothing about the registry. */
  | { kind: 'failed' }
  /** The registry asked to slow down (429/503): it gets no more probes this run. */
  | { kind: 'congested' }

/** A probe's cache entry, made for the version a package is declared on. */
interface ProbedEntry {
  key: string
  /** The version list's ETag, as stored. */
  etag: string
}

/**
 * The cache entry a probe leaves: the version list's ETag with the probe's
 * data, which knows only the latest version. Kept apart from the list's own
 * entry, which a declaration on any version may revive.
 */
function probedCacheKey(target: RegistryTarget, path: string): string {
  return `${target.origin}${path}#latest`
}

/** The probe's entry for a package declared on `version`, when there is one. */
function probedEntryFor(target: RegistryTarget, path: string, version: string): ProbedEntry | null {
  const key = probedCacheKey(target, path)
  const entry = readEtag(key)
  return entry?.data.latestVersion === version ? { key, etag: entry.etag } : null
}

/**
 * The version list changed (a 200) under a probe's entry. With an ETag, the
 * response replaced the entry with the whole list: move it to where lists live,
 * as the package may well be behind now. Without one, the stale entry goes.
 */
function retireProbedEntry(probed: ProbedEntry, listKey: string): void {
  if (readEtag(probed.key)?.etag === probed.etag) removeEtag(probed.key)
  else moveEtag(probed.key, listKey)
}

/** The body of a `latest` response, or null when it is not a version document. */
async function decodeLatestManifest(
  raw: Buffer,
  encoding: string | undefined
): Promise<{ version: string; deprecated?: unknown; engines?: unknown } | null> {
  try {
    const manifest = JSON.parse((await decompressBody(raw, encoding)).toString('utf8')) as {
      version?: unknown
    } | null
    return typeof manifest?.version === 'string' ? (manifest as { version: string }) : null
  } catch {
    return null
  }
}

/**
 * Ask the registry which version its `latest` tag points at. When that is the
 * declared one, the package is up to date and its version list is never
 * downloaded. This trusts the `latest` tag, as npm outdated does; inup
 * otherwise takes the highest stable version as latest, and the two differ only
 * while a stable version above the tag exists.
 *
 * One attempt, through the TypeScript transport (the native one decodes only
 * version lists) on its own connection pool. Whatever goes wrong, the version
 * list request that follows has the retries and reports the problem.
 */
async function probeLatest(
  target: RegistryTarget,
  path: string,
  expected: string,
  signal?: AbortSignal
): Promise<LatestProbe> {
  const startedAt = Date.now()
  let raw: Buffer
  let encoding: string | undefined
  try {
    const { statusCode, headers, body } = await httpRequest(target.origin, {
      path: `${path}/latest`,
      // Not the abbreviated media type: a version document has no abbreviated
      // form, and the public registry answers 406 to a request for one.
      headers: registryHeaders(target, 'application/json'),
      headersTimeoutMs: HEADERS_TIMEOUT_MS,
      pool: 'probe',
      signal,
    })
    if (statusCode < 200 || statusCode >= 300) {
      await body.dump().catch(() => undefined)
      if (isCongestionStatus(statusCode)) return { kind: 'congested' }
      return { kind: isRetryableStatus(statusCode) ? 'failed' : 'other' }
    }
    raw = await readBody(body)
    encoding = headerText(headers['content-encoding'])?.toLowerCase()
  } catch {
    signal?.throwIfAborted()
    return { kind: 'failed' }
  }

  const manifest = await decodeLatestManifest(raw, encoding)
  if (manifest?.version !== expected) return { kind: 'other' }
  const data: PackageVersionData = {
    latestVersion: manifest.version,
    // The only version known, and the only one an up-to-date package needs:
    // nothing newer to offer, and older versions are never targets.
    allVersions: [manifest.version],
    deprecated: normalizeDeprecatedMessage(manifest.deprecated),
    enginesNode: extractEnginesNode(manifest.engines),
  }
  await rememberProbe(target, path, data, signal)
  return { kind: 'current', data, latencyMs: Date.now() - startedAt }
}

/**
 * Store the version list's ETag (a HEAD: headers only) with the probe's data,
 * so the next run revalidates instead of probing again. Best-effort: without
 * it, the next run probes again.
 */
async function rememberProbe(
  target: RegistryTarget,
  path: string,
  data: PackageVersionData,
  signal?: AbortSignal
): Promise<void> {
  const key = probedCacheKey(target, path)
  if (!etagFileFor(key)) return
  try {
    const { statusCode, headers, body } = await httpRequest(target.origin, {
      path,
      method: 'HEAD',
      // The media type the version list is requested with: its ETag is the one
      // the next run sends.
      headers: registryHeaders(target, 'application/vnd.npm.install-v1+json'),
      headersTimeoutMs: HEADERS_TIMEOUT_MS,
      pool: 'probe',
      signal,
    })
    await body.dump()
    const etag = headerText(headers.etag)
    if (statusCode >= 200 && statusCode < 300 && etag) writeEtag(key, etag, data)
  } catch {
    signal?.throwIfAborted()
  }
}

/**
 * How a package's lookup starts: from the entry an earlier probe left, with a
 * probe, or with the version list as usual.
 */
type LookupStart =
  | { kind: 'probed'; entry: ProbedEntry }
  | { kind: 'probe'; target: RegistryTarget; path: string; version: string }
  | { kind: 'list' }

function lookupStart(
  packageName: string,
  version: string | undefined,
  fullMetadata: boolean
): LookupStart {
  // Publish times exist only in the full version list, which a release-age
  // policy needs whatever the probe says.
  if (version === undefined || fullMetadata) return { kind: 'list' }
  const target = registryTargetFor(packageName)
  const path = encodeRegistryPath(packageName, target.pathPrefix)
  const entry = probedEntryFor(target, path, version)
  if (entry) return { kind: 'probed', entry }
  if (hasEtag(listCacheKey(target, path, false))) return { kind: 'list' }
  return { kind: 'probe', target, path, version }
}

/**
 * Whether probing a registry still pays this run. A probe that does not find
 * the package current only delays its version list by a round trip, so once a
 * sample is in and fewer than a third found it current (a project far behind,
 * or a registry without `latest` documents), the rest of the run goes straight
 * to the version lists. So does a registry that asked to slow down: probes are
 * requests on top of the version lists, and they answer to no controller.
 */
class ProbeYield {
  private answered = 0
  private current = 0
  private congested = false

  record(current: boolean): void {
    this.answered++
    if (current) this.current++
  }

  congest(): void {
    this.congested = true
  }

  pays(): boolean {
    if (this.congested) return false
    return (
      this.answered < PROBE_YIELD_SAMPLE || this.current >= this.answered * PROBE_YIELD_MIN_CURRENT
    )
  }
}

async function fetchPackageFromRegistry(
  packageName: string,
  fullMetadata: boolean,
  probed: ProbedEntry | null,
  onAttempt?: AttemptObserver,
  onChunk?: OnChunk,
  signal?: AbortSignal
): Promise<PackageVersionData> {
  // Scoped packages may live on a different registry (with credentials) than
  // unscoped ones — resolved from the npm config chain, memoized per scope.
  const target = registryTargetFor(packageName)
  const path = encodeRegistryPath(packageName, target.pathPrefix)
  const listKey = listCacheKey(target, path, fullMetadata)
  // A probe's entry is revalidated like the list's own: while the version list
  // is unchanged (304), so is its latest version, and the package is current.
  const outcome = await fetchFromRegistryWithRetries(
    target,
    path,
    fullMetadata,
    probed?.key ?? listKey,
    onAttempt,
    onChunk,
    signal
  )

  if (outcome.kind === 'success') {
    if (probed && !outcome.revalidated) retireProbedEntry(probed, listKey)
    return withoutControlCharacters(outcome.data)
  }

  // Not found, refused, or exhausted retries against real errors: report unavailable.
  // The registry is the single source of truth — there is no secondary fetch.
  return { latestVersion: 'unknown', allVersions: [] }
}

/**
 * The deprecation message and engines range are free text from the package
 * author, and both reach the terminal. Cleaned here because every source meets
 * here: either decoder, and a 304 served from an ETag entry written by either
 * (or by an older release).
 */
function withoutControlCharacters(data: PackageVersionData): PackageVersionData {
  if (data.deprecated) data.deprecated = stripControlCharacters(data.deprecated)
  if (data.enginesNode) data.enginesNode = stripControlCharacters(data.enginesNode)
  return data
}

/**
 * Fetches version data for a list of packages from the npm registry.
 *
 * Concurrency model:
 * - A single resizable semaphore caps in-flight fetches. Package names are
 *   pulled from a work queue and dispatched as slots free up (a lazy pump),
 *   rather than pre-sliced into fixed batches.
 * - A hill-climb controller moves the limit at run time: it slow-starts and
 *   climbs to the goodput knee — adapting DOWN on slow-but-healthy links — and
 *   backs off on congestion (429/503) or errors. `concurrency` pins the limit
 *   outright and disables the controller.
 * - Tiny runs skip the controller and run at a fixed `min(learned ?? ceil, count)`
 *   so they never crawl up from the floor and lose to fixed — while still
 *   honoring a persisted slow-link profile.
 * - No body timeout: slow responses finish. Real network errors and header
 *   stalls are retried with backoff; after the retry budget is exhausted the
 *   package is reported unavailable (`latestVersion: 'unknown'`).
 * - Unchanged packuments are revalidated via ETag (304), skipping re-download.
 * - A package in `latestProbes` with nothing cached is first checked against
 *   the registry's `latest` tag on a lane of its own: probes are tiny and
 *   latency-bound, so they neither hold download slots nor feed the
 *   controller. A pinned limit covers both: the lane is then the semaphore.
 *
 * Callbacks:
 * - `onPackageReady` fires once per package the moment it resolves, in
 *   completion order. Consumers that need a stable order sort on their side;
 *   nothing waits for a slower earlier package.
 * - `onControlTick` (optional) reports each adaptive control decision for
 *   instrumentation.
 * - `onNetworkProfile` (optional) fires once at the end of a run whose
 *   hill-climb controller settled on a limit worth persisting.
 * - `onAccessDenied` (optional) fires for each package whose registry refused
 *   the request (401/403). Refusals are not retried; the package reports
 *   unavailable like a 404.
 */
export async function fetchPackageVersions(
  packageNames: string[],
  options: {
    onPackageReady?: OnPackageReadyCallback
    currentVersions?: Map<string, string>
    onControlTick?: (tick: ControlTick) => void
    /** Per-package successful round-trip latency, for perf diagnostics. */
    onPackageTiming?: (name: string, latencyMs: number) => void
    /** Fires once per package whose registry refused access (401/403). */
    onAccessDenied?: (denial: RegistryAccessDenial) => void
    /**
     * Fetch the FULL packument instead of the abbreviated install-v1 format. Larger payloads,
     * but includes per-version publish times — required by release-age policies. Default: false.
     */
    fullMetadata?: boolean
    /**
     * Per package, the stable version every declaration of it is on. Such a package with
     * nothing cached is first checked against the registry's `latest` tag; when the tag names
     * this version, its version list is never fetched (see probeLatest).
     */
    latestProbes?: Map<string, string>
  } & FetchPackageVersionsOptions = {}
): Promise<Map<string, PackageVersionData>> {
  const packageData = new Map<string, PackageVersionData>()

  const total = packageNames.length
  if (total === 0) {
    return packageData
  }

  const pinned = options.concurrency
  const networkProfile = options.networkProfile ?? null

  const controller =
    pinned === undefined && HillClimbController.shouldControl(total)
      ? new HillClimbController(total, {
          profile: networkProfile,
          onTick: options.onControlTick,
        })
      : null
  const initialLimit =
    pinned !== undefined
      ? // Belt-and-braces: cli/.inuprc validators already bound the pin, but
        // this is the last stop before the semaphore — never exceed the pool.
        clamp(Math.floor(pinned), 1, Math.min(total, POOL_CONNECTIONS))
      : controller
        ? controller.getLimit()
        : // Too small to control: smart fixed start, capped by any learned
          // slow-link limit so small projects still benefit from the profile.
          Math.max(1, Math.min(networkProfile?.learnedLimit ?? POOL_CONNECTIONS, total))
  const semaphore = new ResizableSemaphore(initialLimit)

  let completedCount = 0
  const fullMetadata = options.fullMetadata ?? false
  const probeLane = pinned !== undefined ? semaphore : new ResizableSemaphore(PROBE_CONNECTIONS)
  const probeYields = new Map<string, ProbeYield>()

  // Streamed body bytes feed the controller's cold-window goodput as they
  // arrive, not when a response completes — completion order is size-biased.
  const onChunk: OnChunk | undefined = controller
    ? (bytes) => controller.recordBytes(bytes)
    : undefined

  // --- per-attempt observer ---------------------------------------------------
  // Feeds the adaptive controller AND (optionally) reports per-package latency
  // and refusals. Built per package so the callbacks know the name.
  const observerFor = (packageName: string): AttemptObserver | undefined => {
    if (!controller && !options.onPackageTiming && !options.onAccessDenied) return undefined
    return (outcome) => {
      if (outcome.kind === 'success') {
        // A success can also demand an immediate limit change (the hill-climb
        // controller's failed profile validation), so apply any returned limit.
        const next = controller?.record('success', outcome.latencyMs, {
          revalidated: outcome.revalidated,
          bytes: outcome.bytes,
        })
        if (next != null) semaphore.setLimit(next)
        options.onPackageTiming?.(packageName, outcome.latencyMs)
      } else if (outcome.kind === 'congested') {
        const next = controller?.record('congested')
        if (next != null) semaphore.setLimit(next)
      } else if (outcome.kind === 'retryable') {
        controller?.record('retryable')
      } else if (outcome.kind === 'transient') {
        controller?.record('transient')
      } else if (outcome.kind === 'denied') {
        options.onAccessDenied?.({ packageName, origin: outcome.origin, status: outcome.status })
      }
    }
  }

  const publish = (packageName: string, data: PackageVersionData): void => {
    options.signal?.throwIfAborted()
    packageData.set(packageName, data)
    completedCount++
    options.onPackageReady?.({ packageName, data })
  }

  /** The package's probe on the lane, or null once probing stopped paying. */
  const probeOnLane = async (
    start: Extract<LookupStart, { kind: 'probe' }>
  ): Promise<LatestProbe | null> => {
    await probeLane.acquire()
    try {
      options.signal?.throwIfAborted()
      // Judged once a slot is free, so every answer in so far counts.
      const { origin } = start.target
      const probeYield = probeYields.get(origin) ?? new ProbeYield()
      probeYields.set(origin, probeYield)
      if (!probeYield.pays()) return null
      const probe = await probeLatest(start.target, start.path, start.version, options.signal)
      if (probe.kind === 'congested') probeYield.congest()
      else if (probe.kind !== 'failed') probeYield.record(probe.kind === 'current')
      return probe
    } finally {
      probeLane.release()
    }
  }

  // --- worker: pull from the queue until exhausted ----------------------------
  let cursor = 0
  const runOne = async (index: number): Promise<void> => {
    const packageName = packageNames[index]
    const start = lookupStart(packageName, options.latestProbes?.get(packageName), fullMetadata)
    const probe = start.kind === 'probe' ? await probeOnLane(start) : null
    if (probe?.kind === 'current') {
      options.onPackageTiming?.(packageName, probe.latencyMs)
      publish(packageName, withoutControlCharacters(probe.data))
      return
    }
    await semaphore.acquire()
    try {
      options.signal?.throwIfAborted()
      const data = await getFreshPackageData(
        packageName,
        options.currentVersions?.get(packageName),
        fullMetadata,
        start.kind === 'probed' ? start.entry : null,
        observerFor(packageName),
        onChunk,
        options.signal
      )
      publish(packageName, data)

      if (controller) {
        // Run tail: with fewer pending items than the limit the drain would
        // read as a goodput collapse — stop deciding (and stop learning).
        if (total - completedCount < 2 * controller.getLimit()) {
          controller.freeze()
        }
        // Bytes streamed by the native transport since the last completion.
        const nativeBytes = nativeTransport()?.takeReceivedBytes() ?? 0
        if (nativeBytes > 0) onChunk?.(nativeBytes)
        const next = controller.maybeTick()
        if (next !== null) semaphore.setLimit(next)
      }
    } finally {
      semaphore.release()
    }
  }

  // The pump: keep enough workers running to saturate the (possibly growing)
  // limit. We dispatch all indices as promises but each one waits on the
  // semaphore before doing work, so the semaphore — not the dispatch loop —
  // enforces the limit. Growing the limit lets queued acquirers through.
  const workers: Promise<void>[] = []
  while (cursor < total) {
    workers.push(runOne(cursor))
    cursor++
  }

  await Promise.all(workers)

  if (controller && options.onNetworkProfile) {
    const settled = controller.getSettledProfile()
    if (settled) options.onNetworkProfile(settled)
  }

  return packageData
}

/**
 * Clears the in-run in-flight dedupe map. Only meaningful within a single run
 * (the map collapses duplicate concurrent lookups); registry data itself is
 * never cached in memory across runs. Used by tests to isolate fetches.
 */
export function clearPackageCache(): void {
  inFlightLookups.clear()
  jsOnlyOrigins.clear()
}
