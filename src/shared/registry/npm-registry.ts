import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { brotliDecompress, gunzip, inflate } from 'node:zlib'

const gunzipAsync = promisify(gunzip)
const inflateAsync = promisify(inflate)
const brotliDecompressAsync = promisify(brotliDecompress)

import { POOL_CONNECTIONS } from '../config'
import { debugLog } from '../debug-logger'
import { etagFileFor, readEtag, writeEtag } from '../http/etag-store'
import { type ControlTick, HillClimbController } from '../http/hill-climb-controller'
import { httpRequest } from '../http/http-request'
import { InflightMap } from '../http/inflight'
import { ResizableSemaphore } from '../http/resizable-semaphore'
import {
  isCongestionStatus,
  isRetryableStatus,
  isTransientNetworkError,
  parseRetryAfterMs,
  sleep,
} from '../http/retry'
import { clamp } from '../math'
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
  onAttempt?: AttemptObserver,
  onChunk?: OnChunk,
  signal?: AbortSignal
): Promise<PackageVersionData> {
  // A cancellable run owns its request; cancelling it must not abort another
  // caller's deduplicated lookup of the same package.
  if (signal) return fetchPackageFromRegistry(packageName, fullMetadata, onAttempt, onChunk, signal)
  // Abbreviated and full responses parse to different shapes, so they must never
  // share an in-flight entry.
  const cacheKey = `${packageName}@${currentVersion ?? ''}${fullMetadata ? '#full' : ''}`
  return inFlightLookups.dedupe(cacheKey, () =>
    fetchPackageFromRegistry(packageName, fullMetadata, onAttempt, onChunk)
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

/** Decompress a response body according to its content-encoding. */
async function decompressBody(raw: Buffer, encoding: string | undefined): Promise<Buffer> {
  if (encoding === 'gzip') return gunzipAsync(raw)
  if (encoding === 'br') return brotliDecompressAsync(raw)
  if (encoding === 'deflate') return inflateAsync(raw)
  return raw
}

/**
 * Turn a 200 body into version data and persist its ETag entry for the next
 * run's conditional request. Uses the Rust core when one is enabled; if it
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
  signal?: AbortSignal
): Promise<RegistryAttemptOutcome | null> {
  const result = await transport.fetch(
    {
      url: `${target.origin}${path}`,
      authorization: target.authHeader,
      cacheFile: etagFileFor(`${target.origin}${path}`),
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
      return { kind: 'not-found' }
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
  onChunk?: OnChunk,
  signal?: AbortSignal
): Promise<RegistryAttemptOutcome> {
  // The native transport asks for — and its decoder keeps — only the abbreviated
  // document, which carries no `time`. A run that needs publish times takes the
  // JS path instead of silently losing the field the policy depends on.
  const transport = fullMetadata ? null : nativeTransportFor(target.origin)
  if (transport) {
    const outcome = await attemptNative(transport, target, path, signal)
    if (outcome) return outcome
  }
  return attemptWithNodeHttp(target, path, fullMetadata, onChunk, signal)
}

async function attemptWithNodeHttp(
  target: RegistryTarget,
  path: string,
  fullMetadata: boolean,
  onChunk?: OnChunk,
  signal?: AbortSignal
): Promise<RegistryAttemptOutcome> {
  const startedAt = Date.now()
  // Conditional request: if we have a stored ETag for this packument, ask the
  // registry to validate it. Unchanged → 304 (no body) and we reuse stored data.
  // This still hits the registry every run, so data is never served stale.
  // Keys are origin-qualified so two registries can never collide on a path.
  // Full-packument responses parse to richer data (publish times), so they get
  // their own cache entry — a 304 must never revive an abbreviated-format body.
  const cacheKey = `${target.origin}${path}${fullMetadata ? '#full' : ''}`
  const cached = readEtag(cacheKey)
  try {
    const requestHeaders: Record<string, string> = {
      // The abbreviated install-v1 format is much smaller but has no `time` field;
      // release-age policies need publish times, hence the full packument.
      accept: fullMetadata ? 'application/json' : 'application/vnd.npm.install-v1+json',
      'accept-encoding': 'gzip, deflate, br',
    }
    if (target.authHeader) {
      requestHeaders.authorization = target.authHeader
    }
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
      return { kind: 'not-found' }
    }

    const raw = await readBody(body, onChunk)
    const encodingHeader = headers['content-encoding']
    const encoding = (Array.isArray(encodingHeader) ? encodingHeader[0] : encodingHeader)
      ?.toString()
      .toLowerCase()
    const etagHeader = headers.etag
    const etag = (Array.isArray(etagHeader) ? etagHeader[0] : etagHeader)?.toString()
    const data = await decodePackument(raw, encoding, cacheKey, etag, fullMetadata)

    return {
      kind: 'success',
      data,
      latencyMs: Date.now() - startedAt,
      revalidated: false,
      bytes: raw.length,
    }
  } catch (error) {
    signal?.throwIfAborted()
    if (isTransientNetworkError(error)) {
      return { kind: 'transient' }
    }
    // Unknown error: treat as transient so we try the fallback rather than
    // silently returning 'unknown'.
    return { kind: 'transient' }
  }
}

async function fetchFromRegistryWithRetries(
  target: RegistryTarget,
  path: string,
  fullMetadata: boolean,
  onAttempt?: AttemptObserver,
  onChunk?: OnChunk,
  signal?: AbortSignal
): Promise<RegistryAttemptOutcome> {
  let lastOutcome: RegistryAttemptOutcome = { kind: 'transient' }
  for (let attempt = 0; attempt < MAX_REGISTRY_ATTEMPTS; attempt++) {
    signal?.throwIfAborted()
    const outcome = await attemptRegistryFetch(target, path, fullMetadata, onChunk, signal)
    onAttempt?.(outcome)
    if (outcome.kind === 'success' || outcome.kind === 'not-found') {
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

async function fetchPackageFromRegistry(
  packageName: string,
  fullMetadata: boolean,
  onAttempt?: AttemptObserver,
  onChunk?: OnChunk,
  signal?: AbortSignal
): Promise<PackageVersionData> {
  // Scoped packages may live on a different registry (with credentials) than
  // unscoped ones — resolved from the npm config chain, memoized per scope.
  const target = registryTargetFor(packageName)
  const path = encodeRegistryPath(packageName, target.pathPrefix)
  const outcome = await fetchFromRegistryWithRetries(
    target,
    path,
    fullMetadata,
    onAttempt,
    onChunk,
    signal
  )

  if (outcome.kind === 'success') {
    return outcome.data
  }

  // Not found, or exhausted retries against real errors: report unavailable.
  // The registry is the single source of truth — there is no secondary fetch.
  return { latestVersion: 'unknown', allVersions: [] }
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
 *
 * Callbacks:
 * - `onPackageReady` fires once per package the moment it resolves, in
 *   completion order. Consumers that need a stable order sort on their side;
 *   nothing waits for a slower earlier package.
 * - `onControlTick` (optional) reports each adaptive control decision for
 *   instrumentation.
 * - `onNetworkProfile` (optional) fires once at the end of a run whose
 *   hill-climb controller settled on a limit worth persisting.
 */
export async function fetchPackageVersions(
  packageNames: string[],
  options: {
    onPackageReady?: OnPackageReadyCallback
    currentVersions?: Map<string, string>
    onControlTick?: (tick: ControlTick) => void
    /** Per-package successful round-trip latency, for perf diagnostics. */
    onPackageTiming?: (name: string, latencyMs: number) => void
    /**
     * Fetch the FULL packument instead of the abbreviated install-v1 format. Larger payloads,
     * but includes per-version publish times — required by release-age policies. Default: false.
     */
    fullMetadata?: boolean
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

  // Streamed body bytes feed the controller's cold-window goodput as they
  // arrive, not when a response completes — completion order is size-biased.
  const onChunk: OnChunk | undefined = controller
    ? (bytes) => controller.recordBytes(bytes)
    : undefined

  // --- per-attempt observer ---------------------------------------------------
  // Feeds the adaptive controller AND (optionally) reports per-package latency
  // for diagnostics. Built per package so the timing callback knows the name.
  const observerFor = (packageName: string): AttemptObserver | undefined => {
    if (!controller && !options.onPackageTiming) return undefined
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
      }
    }
  }

  // --- worker: pull from the queue until exhausted ----------------------------
  let cursor = 0
  const runOne = async (index: number): Promise<void> => {
    const packageName = packageNames[index]
    await semaphore.acquire()
    try {
      options.signal?.throwIfAborted()
      const data = await getFreshPackageData(
        packageName,
        options.currentVersions?.get(packageName),
        options.fullMetadata ?? false,
        observerFor(packageName),
        onChunk,
        options.signal
      )
      options.signal?.throwIfAborted()
      packageData.set(packageName, data)
      completedCount++
      options.onPackageReady?.({ packageName, data })

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
