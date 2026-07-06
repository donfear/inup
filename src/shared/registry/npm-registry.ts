import { promisify } from 'node:util'
import { brotliDecompress, gunzip, inflate } from 'node:zlib'
import { Pool } from 'undici'

const gunzipAsync = promisify(gunzip)
const inflateAsync = promisify(inflate)
const brotliDecompressAsync = promisify(brotliDecompress)

import { POOL_CONNECTIONS } from '../config'
import { AdaptiveController, type ControlTick } from '../http/adaptive-controller'
import { readEtag, writeEtag } from '../http/etag-store'
import { InflightMap } from '../http/inflight'
import { ResizableSemaphore } from '../http/resizable-semaphore'
import {
  isCongestionStatus,
  isRetryableStatus,
  isTransientNetworkError,
  parseRetryAfterMs,
  sleep,
} from '../http/retry'
import type {
  FetchPackageVersionsOptions,
  OnBatchReadyCallback,
  RegistryBatchProgressItem,
} from '../types'
import { parseVersions } from '../versions'
import { type RegistryTarget, registryTargetFor } from './registry-config'

export interface PackageVersionData {
  latestVersion: string
  allVersions: string[]
  deprecated?: string // npm deprecation message for the latest version, if any
  enginesNode?: string // declared engines.node range for the latest version, if any
  /** ISO publish time per version; only present when the full packument was fetched. */
  publishTimes?: Record<string, string>
}

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
  fullMetadata: boolean,
  onAttempt?: AttemptObserver
): Promise<PackageVersionData> {
  const cacheKey = `${packageName}@${currentVersion ?? ''}${fullMetadata ? '#full' : ''}`
  return inFlightLookups.dedupe(cacheKey, () =>
    fetchPackageFromRegistry(packageName, fullMetadata, onAttempt)
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
  | { kind: 'success'; data: PackageVersionData; latencyMs: number }
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

async function attemptRegistryFetch(
  target: RegistryTarget,
  path: string,
  fullMetadata: boolean
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
      return { kind: 'success', data: cached.data, latencyMs: Date.now() - startedAt }
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

    const raw = Buffer.from(await body.arrayBuffer())
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
  fullMetadata: boolean,
  onAttempt?: AttemptObserver
): Promise<RegistryAttemptOutcome> {
  let lastOutcome: RegistryAttemptOutcome = { kind: 'transient' }
  for (let attempt = 0; attempt < MAX_REGISTRY_ATTEMPTS; attempt++) {
    const outcome = await attemptRegistryFetch(target, path, fullMetadata)
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
  fullMetadata: boolean,
  onAttempt?: AttemptObserver
): Promise<PackageVersionData> {
  // Scoped packages may live on a different registry (with credentials) than
  // unscoped ones — resolved from the npm config chain, memoized per scope.
  const target = registryTargetFor(packageName)
  const path = encodeRegistryPath(packageName, target.pathPrefix)
  const outcome = await fetchFromRegistryWithRetries(target, path, fullMetadata, onAttempt)

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
 * - `adaptive` (default true) enables an AIMD controller that ramps the limit to
 *   the ceiling on a healthy link and backs off on congestion (429/503) or
 *   errors. With `adaptive:false` the limit is fixed at `maxConcurrency` (the A/B
 *   control arm), reproducing the legacy fixed path.
 * - Tiny runs (<= ceil packages) skip the controller and run at a fixed
 *   `min(ceil, count)` so they never crawl up from the floor and lose to fixed.
 * - No body timeout: slow responses finish. Real network errors and header
 *   stalls are retried with backoff; after the retry budget is exhausted the
 *   package is reported unavailable (`latestVersion: 'unknown'`).
 * - Unchanged packuments are revalidated via ETag (304), skipping re-download.
 *
 * Callbacks:
 * - `onBatchReady` fires once an emission window has resolved, in original order.
 *   Emission windows are fixed-size groupings for UI progress only; they do not
 *   gate concurrency.
 * - `onControlTick` (optional) reports each adaptive control decision for
 *   instrumentation.
 */
export async function fetchPackageVersions(
  packageNames: string[],
  options: {
    onBatchReady?: OnBatchReadyCallback
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

  const adaptive = options.adaptive ?? true
  // `maxConcurrency` is the fixed cap used only when adaptive is off; it never
  // caps the adaptive start (the controller smart-starts near the work size and
  // ramps to the ceiling, which beats a low fixed start on large runs).
  const fixedConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_FIXED_CONCURRENCY)

  const controller =
    adaptive && AdaptiveController.shouldControl(total)
      ? new AdaptiveController(total, options.onControlTick)
      : null
  const initialLimit = controller
    ? controller.getLimit()
    : adaptive
      ? Math.min(POOL_CONNECTIONS, total) // too small to control: smart fixed start
      : fixedConcurrency
  const semaphore = new ResizableSemaphore(initialLimit)

  // --- emission ordering (unchanged contract) ---------------------------------
  let completedCount = 0
  const pendingEmissions = new Map<number, RegistryBatchProgressItem[]>()
  let nextEmitIndex = 0
  const flushPending = () => {
    while (true) {
      const ready = pendingEmissions.get(nextEmitIndex)
      if (!ready) break
      pendingEmissions.delete(nextEmitIndex)
      options.onBatchReady?.(ready)
      nextEmitIndex++
    }
  }

  // Emission windows group results for UI progress only (decoupled from
  // concurrency). Sizes come from `batchSizes` (a sequence, last value repeats)
  // or a uniform `batchSize`. We precompute, per package index, which window it
  // belongs to and its position within that window, so a window can flush as soon
  // as all its items resolve — preserving original order via `flushPending`.
  const windowSizes =
    options.batchSizes && options.batchSizes.length > 0
      ? options.batchSizes.map((size) => Math.max(1, size))
      : [Math.max(1, options.batchSize ?? 25)]
  const windowIdByIndex = new Array<number>(total)
  const itemIndexByIndex = new Array<number>(total)
  const windowRemaining: number[] = []
  {
    let cursorIndex = 0
    let windowId = 0
    while (cursorIndex < total) {
      const size = windowSizes[Math.min(windowId, windowSizes.length - 1)]
      const end = Math.min(cursorIndex + size, total)
      windowRemaining[windowId] = end - cursorIndex
      for (let i = cursorIndex; i < end; i++) {
        windowIdByIndex[i] = windowId
        itemIndexByIndex[i] = i - cursorIndex
      }
      cursorIndex = end
      windowId++
    }
  }
  const windowResults = windowRemaining.map(() => [] as RegistryBatchProgressItem[])

  // --- per-attempt observer ---------------------------------------------------
  // Feeds the adaptive controller AND (optionally) reports per-package latency
  // for diagnostics. Built per package so the timing callback knows the name.
  const observerFor = (packageName: string): AttemptObserver | undefined => {
    if (!controller && !options.onPackageTiming) return undefined
    return (outcome) => {
      if (outcome.kind === 'success') {
        controller?.record('success', outcome.latencyMs)
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
        options.fullMetadata ?? false,
        observerFor(packageName)
      )
      packageData.set(packageName, data)
      completedCount++

      const w = windowIdByIndex[index]
      const itemIndex = itemIndexByIndex[index]
      // Index by position (not push) so items keep their original in-window order
      // even when they resolve out of order.
      windowResults[w][itemIndex] = {
        packageName,
        data,
        completed: completedCount,
        total,
        batchIndex: w,
        itemIndex,
      }
      if (--windowRemaining[w] === 0) {
        pendingEmissions.set(w, windowResults[w])
        flushPending()
      }

      if (controller) {
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
