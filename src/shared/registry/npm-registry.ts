import { promisify } from 'node:util'
import { brotliDecompress, gunzip, inflate } from 'node:zlib'
import { Pool } from 'undici'

const gunzipAsync = promisify(gunzip)
const inflateAsync = promisify(inflate)
const brotliDecompressAsync = promisify(brotliDecompress)

import { POOL_CONNECTIONS } from '../config'
import { AdaptiveController } from '../http/adaptive-controller'
import type { ConcurrencyController, ControlTick } from '../http/controller-contract'
import { readEtag, writeEtag } from '../http/etag-store'
import { HillClimbController } from '../http/hill-climb-controller'
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

// Aliased so the registry payload can never drift from what parseVersions emits.
export type PackageVersionData = ParsedVersions

const inFlightLookups = new InflightMap<PackageVersionData>()

// One pool per registry origin: scoped packages may resolve to different
// registries (`@scope:registry` in .npmrc), and each origin keeps its own
// keep-alive connections. Most runs still touch a single origin.
//
// Connection count is kept == the adaptive controller's ceiling (POOL_CONNECTIONS)
// so the controller is never silently throttled below its chosen limit. Idle
// keep-alive connections are cheap.
//
// `headersTimeout` is intentionally non-zero (unlike the rest, where we tolerate
// slow bodies): a stalled connection that never sends headers would otherwise be
// consumed forever and stay invisible to the completion-based adaptive
// controller. With a headers timeout, a stall surfaces as a transient error the
// controller can react to (and retry handles). `bodyTimeout` stays 0 — large
// packuments legitimately stream slowly.
const poolByOrigin = new Map<string, Pool>()

function poolFor(origin: string): Pool {
  let pool = poolByOrigin.get(origin)
  if (!pool) {
    pool = new Pool(origin, {
      connections: POOL_CONNECTIONS,
      pipelining: 1,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 600_000,
      headersTimeout: 30_000,
      bodyTimeout: 0,
      connectTimeout: 15_000,
      allowH2: false,
    })
    poolByOrigin.set(origin, pool)
  }
  return pool
}

const MAX_REGISTRY_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [500, 1500, 3000]

// Fixed concurrency used when adaptive is disabled (INUP_ADAPTIVE=0, the A/B
// control arm). Matches the production caller (PackageDetector) so the fixed path
// reproduces the legacy behavior exactly.
const DEFAULT_FIXED_CONCURRENCY = 10

async function getFreshPackageData(
  packageName: string,
  currentVersion: string | undefined,
  onAttempt?: AttemptObserver,
  onChunk?: OnChunk
): Promise<PackageVersionData> {
  const cacheKey = `${packageName}@${currentVersion ?? ''}`
  return inFlightLookups.dedupe(cacheKey, () =>
    fetchPackageFromRegistry(packageName, onAttempt, onChunk)
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

type ResponseBody = {
  arrayBuffer(): Promise<ArrayBuffer>
} & Partial<AsyncIterable<Uint8Array>>

// Dev-only link emulation (INUP_PACE_BPS): a process-wide token bucket that
// paces every streamed chunk to the given bytes/sec, so slow-link behavior can
// be reproduced without a system-level link conditioner. Read per call so the
// toggle is testable; never set in normal use.
let paceAllowedAt = 0
async function paceChunk(bytes: number): Promise<void> {
  const rate = Number(process.env.INUP_PACE_BPS)
  if (!(rate > 0)) return
  const now = Date.now()
  paceAllowedAt = Math.max(paceAllowedAt, now) + (bytes / rate) * 1000
  // Own timer rather than retry's sleep(): that helper is stubbed to be instant
  // in tests, and pacing must stay observable there. The deadline is always at
  // or after `now`, so the wait is never negative.
  await new Promise<void>((resolve) => setTimeout(resolve, paceAllowedAt - now))
}

/**
 * Read a response body to a Buffer. Streams chunk by chunk when the body is
 * async-iterable so the caller can account bytes as they arrive (the adaptive
 * controller measures cold windows in bytes/sec); falls back to arrayBuffer()
 * for bodies that are not (test doubles, the offline bench harness).
 */
async function readBody(body: ResponseBody, onChunk?: OnChunk): Promise<Buffer> {
  if (typeof body[Symbol.asyncIterator] !== 'function') {
    return Buffer.from(await body.arrayBuffer())
  }
  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    await paceChunk(chunk.length)
    onChunk?.(chunk.length)
    chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
  }
  return Buffer.concat(chunks)
}

async function attemptRegistryFetch(
  target: RegistryTarget,
  path: string,
  onChunk?: OnChunk
): Promise<RegistryAttemptOutcome> {
  const startedAt = Date.now()
  // Conditional request: if we have a stored ETag for this packument, ask the
  // registry to validate it. Unchanged → 304 (no body) and we reuse stored data.
  // This still hits the registry every run, so data is never served stale.
  // Keys are origin-qualified so two registries can never collide on a path.
  const cacheKey = `${target.origin}${path}`
  const cached = readEtag(cacheKey)
  try {
    const requestHeaders: Record<string, string> = {
      accept: 'application/vnd.npm.install-v1+json',
      'accept-encoding': 'gzip, deflate, br',
    }
    if (target.authHeader) {
      requestHeaders.authorization = target.authHeader
    }
    if (cached) {
      requestHeaders['if-none-match'] = cached.etag
    }

    const { statusCode, headers, body } = await poolFor(target.origin).request({
      path,
      method: 'GET',
      headers: requestHeaders,
      headersTimeout: 30_000,
      bodyTimeout: 0,
      blocking: false,
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
    let decoded: Buffer
    if (encoding === 'gzip') {
      decoded = await gunzipAsync(raw)
    } else if (encoding === 'br') {
      decoded = await brotliDecompressAsync(raw)
    } else if (encoding === 'deflate') {
      decoded = await inflateAsync(raw)
    } else {
      decoded = raw
    }
    const data = parseVersions(decoded.toString('utf8'))

    // Persist the ETag for next run's conditional request.
    const etagHeader = headers.etag
    const etag = Array.isArray(etagHeader) ? etagHeader[0] : etagHeader
    if (etag) {
      writeEtag(cacheKey, etag.toString(), data)
    }

    return {
      kind: 'success',
      data,
      latencyMs: Date.now() - startedAt,
      revalidated: false,
      bytes: raw.length,
    }
  } catch (error) {
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
  onAttempt?: AttemptObserver,
  onChunk?: OnChunk
): Promise<RegistryAttemptOutcome> {
  let lastOutcome: RegistryAttemptOutcome = { kind: 'transient' }
  for (let attempt = 0; attempt < MAX_REGISTRY_ATTEMPTS; attempt++) {
    const outcome = await attemptRegistryFetch(target, path, onChunk)
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
      await sleep(backoff)
    }
  }
  return lastOutcome
}

async function fetchPackageFromRegistry(
  packageName: string,
  onAttempt?: AttemptObserver,
  onChunk?: OnChunk
): Promise<PackageVersionData> {
  // Scoped packages may live on a different registry (with credentials) than
  // unscoped ones — resolved from the npm config chain, memoized per scope.
  const target = registryTargetFor(packageName)
  const path = encodeRegistryPath(packageName, target.pathPrefix)
  const outcome = await fetchFromRegistryWithRetries(target, path, onAttempt, onChunk)

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
 * - `adaptive` (default true) enables a controller that moves the limit at run
 *   time. `controllerMode` picks which: 'hillclimb' (default) slow-starts and
 *   climbs to the goodput knee — adapting DOWN on slow-but-healthy links;
 *   'aimd' (the A/B control arm) ramps to the ceiling and backs off only on
 *   congestion (429/503) or errors. With `adaptive:false` the limit is fixed at
 *   `maxConcurrency`, reproducing the legacy fixed path. `concurrency` pins the
 *   limit outright and disables everything adaptive.
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
  } & FetchPackageVersionsOptions = {}
): Promise<Map<string, PackageVersionData>> {
  const packageData = new Map<string, PackageVersionData>()

  const total = packageNames.length
  if (total === 0) {
    return packageData
  }

  const pinned = options.concurrency
  const adaptive = pinned === undefined && (options.adaptive ?? true)
  const controllerMode = options.controllerMode ?? 'hillclimb'
  const networkProfile = options.networkProfile ?? null
  // `maxConcurrency` is the fixed cap used only when adaptive is off; it never
  // caps the adaptive start.
  const fixedConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_FIXED_CONCURRENCY)

  let controller: ConcurrencyController | null = null
  if (adaptive) {
    if (controllerMode === 'hillclimb' && HillClimbController.shouldControl(total)) {
      controller = new HillClimbController(total, {
        profile: networkProfile,
        onTick: options.onControlTick,
        // INUP_FASTLINK=0: A/B toggle that keeps the controller on but never
        // lets streamed throughput pin the ceiling.
        tuning:
          process.env.INUP_FASTLINK === '0' ? { fastLinkBytesPerSec: Number.MAX_VALUE } : undefined,
      })
    } else if (controllerMode === 'aimd' && AdaptiveController.shouldControl(total)) {
      controller = new AdaptiveController(total, options.onControlTick)
    }
  }
  const initialLimit =
    pinned !== undefined
      ? // Belt-and-braces: cli/.inuprc validators already bound the pin, but
        // this is the last stop before the semaphore — never exceed the pool.
        clamp(Math.floor(pinned), 1, Math.min(total, POOL_CONNECTIONS))
      : controller
        ? controller.getLimit()
        : adaptive
          ? // Too small to control: smart fixed start, capped by any learned
            // slow-link limit so small projects still benefit from the profile.
            Math.max(1, Math.min(networkProfile?.learnedLimit ?? POOL_CONNECTIONS, total))
          : fixedConcurrency
  const semaphore = new ResizableSemaphore(initialLimit)

  let completedCount = 0

  // Streamed body bytes feed the controller's cold-window goodput as they
  // arrive, not when a response completes — completion order is size-biased.
  const onChunk: OnChunk | undefined = controller?.recordBytes
    ? (bytes) => controller?.recordBytes?.(bytes)
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
      const data = await getFreshPackageData(
        packageName,
        options.currentVersions?.get(packageName),
        observerFor(packageName),
        onChunk
      )
      packageData.set(packageName, data)
      completedCount++
      options.onPackageReady?.({ packageName, data })

      if (controller) {
        // Run tail: with fewer pending items than the limit the drain would
        // read as a goodput collapse — stop deciding (and stop learning).
        if (total - completedCount < 2 * controller.getLimit()) {
          controller.freeze?.()
        }
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

  if (controller instanceof HillClimbController && options.onNetworkProfile) {
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
}
