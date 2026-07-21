import { Pool } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Keep retry classification real, but make backoff instant so retry-exhaustion
// paths don't actually sleep during tests.
vi.mock('../../../../src/shared/http/retry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/shared/http/retry')>()),
  sleep: vi.fn().mockResolvedValue(undefined),
}))

// Pin registry resolution to the public registry so this suite never depends on
// the machine's real npm configuration. Individual tests override per call.
const { registryTargetMock } = vi.hoisted(() => ({
  registryTargetMock: vi.fn((): { origin: string; pathPrefix: string; authHeader?: string } => ({
    origin: 'https://registry.npmjs.org',
    pathPrefix: '',
  })),
}))
vi.mock('../../../../src/shared/registry/registry-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/shared/registry/registry-config')>()),
  registryTargetFor: registryTargetMock,
}))

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import type { ControlTick } from '../../../../src/shared/http/adaptive-controller'
import { setEtagCacheEnabled, setEtagCacheRoot } from '../../../../src/shared/http/etag-store'
import {
  clearPackageCache,
  fetchPackageVersions,
} from '../../../../src/shared/registry/npm-registry'

type MockResponse = {
  statusCode: number
  body: string
  headers?: Record<string, string>
  /** Optional artificial delay (ms) before the response resolves. */
  delayMs?: number
}

const makeOkBody = (json: unknown): MockResponse => ({
  statusCode: 200,
  body: JSON.stringify(json),
})

const makeErrBody = (statusCode: number): MockResponse => ({
  statusCode,
  body: '',
})

describe('npm-registry', () => {
  const requestMock = vi.fn<(opts: { path: string }) => Promise<MockResponse>>()

  const poolRequestSpy = vi
    .spyOn(Pool.prototype, 'request')
    .mockImplementation(async (opts: unknown) => {
      const { path } = opts as { path: string }
      const response = await requestMock({ path })
      if (response.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, response.delayMs))
      }
      return {
        statusCode: response.statusCode,
        headers: response.headers ?? {},
        trailers: {},
        opaque: null,
        context: {},
        body: {
          arrayBuffer: async () => Buffer.from(response.body, 'utf8'),
          text: async () => response.body,
          dump: async () => {},
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    })

  beforeEach(() => {
    clearPackageCache()
    requestMock.mockReset()
    // Keep the on-disk ETag cache out of these tests for determinism; it has its
    // own dedicated suite. (The pool mock returns no etag header anyway.)
    setEtagCacheEnabled(false)
  })

  afterEach(() => {
    poolRequestSpy.mockClear()
    setEtagCacheEnabled(true)
  })

  it('fetches version data from npm registry', async () => {
    requestMock.mockResolvedValue(
      makeOkBody({
        versions: {
          '1.0.0': {},
          '1.2.0': {},
          '2.0.0-beta.1': {},
          '1.1.0': {},
        },
      })
    )

    const result = await fetchPackageVersions(['demo-pkg'])

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '1.2.0',
      allVersions: ['1.2.0', '1.1.0', '1.0.0'],
    })
  })

  it('sends no authorization header when the registry has no credentials', async () => {
    requestMock.mockResolvedValue(makeOkBody({ versions: { '1.0.0': {} } }))

    await fetchPackageVersions(['demo-pkg'])

    const opts = poolRequestSpy.mock.calls[0][0] as { headers: Record<string, string> }
    expect(opts.headers.authorization).toBeUndefined()
  })

  it('routes scoped packages to their npmrc registry with its authorization header', async () => {
    registryTargetMock.mockReturnValueOnce({
      origin: 'https://registry.example.com',
      pathPrefix: '/npm',
      authHeader: 'Bearer sekret',
    })
    requestMock.mockResolvedValue(makeOkBody({ versions: { '1.0.0': {}, '1.1.0': {} } }))

    const result = await fetchPackageVersions(['@myco/private-pkg'])

    const opts = poolRequestSpy.mock.calls[0][0] as {
      path: string
      headers: Record<string, string>
    }
    expect(opts.path).toBe('/npm/@myco/private-pkg')
    expect(opts.headers.authorization).toBe('Bearer sekret')
    expect(result.get('@myco/private-pkg')?.latestVersion).toBe('1.1.0')
  })

  it('returns empty map for empty input', async () => {
    const result = await fetchPackageVersions([])

    expect(result.size).toBe(0)
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('coalesces duplicate in-flight lookups within a run', async () => {
    let resolveRequest: ((value: MockResponse) => void) | undefined
    requestMock.mockImplementation(
      () =>
        new Promise<MockResponse>((resolve) => {
          resolveRequest = resolve
        })
    )

    const pending = fetchPackageVersions(['demo-pkg', 'demo-pkg'])
    await Promise.resolve()
    expect(requestMock).toHaveBeenCalledTimes(1)

    resolveRequest?.(
      makeOkBody({
        versions: {
          '1.0.0': {},
          '1.1.0': {},
        },
      })
    )

    const result = await pending
    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '1.1.0',
      allVersions: ['1.1.0', '1.0.0'],
    })
  })

  it('fetches fresh data again on a later call', async () => {
    requestMock
      .mockResolvedValueOnce(makeOkBody({ versions: { '1.0.0': {} } }))
      .mockResolvedValueOnce(makeOkBody({ versions: { '1.1.0': {}, '1.0.0': {} } }))

    const first = await fetchPackageVersions(['demo-pkg'])
    const second = await fetchPackageVersions(['demo-pkg'])

    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(first.get('demo-pkg')?.latestVersion).toBe('1.0.0')
    expect(second.get('demo-pkg')?.latestVersion).toBe('1.1.0')
  })

  it('returns unknown for failed packages without aborting the batch', async () => {
    requestMock.mockImplementation(async ({ path }) => {
      if (path.includes('good-pkg')) {
        return makeOkBody({ versions: { '1.0.0': {}, '1.1.0': {} } })
      }
      return makeErrBody(404)
    })

    const result = await fetchPackageVersions(['good-pkg', 'bad-pkg'])

    expect(result.get('good-pkg')).toEqual({
      latestVersion: '1.1.0',
      allVersions: ['1.1.0', '1.0.0'],
    })
    expect(result.get('bad-pkg')).toEqual({
      latestVersion: 'unknown',
      allVersions: [],
    })
  })

  it('returns unknown after exhausting retries on a persistently retryable status', async () => {
    requestMock.mockResolvedValue(makeErrBody(429))

    const result = await fetchPackageVersions(['demo-pkg'])

    // Three attempts against a status that never recovers, then give up —
    // there is no secondary source anymore.
    expect(requestMock).toHaveBeenCalledTimes(3)
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: 'unknown',
      allVersions: [],
    })
  })

  it('retries retryable 5xx statuses that are not congestion signals', async () => {
    requestMock.mockResolvedValue(makeErrBody(500))

    const result = await fetchPackageVersions(['demo-pkg'])

    expect(requestMock).toHaveBeenCalledTimes(3)
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: 'unknown',
      allVersions: [],
    })
  })

  it('treats network-level failures as transient and retries', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    requestMock.mockRejectedValue(abortError)

    const result = await fetchPackageVersions(['demo-pkg'])

    expect(requestMock).toHaveBeenCalledTimes(3)
    expect(result.get('demo-pkg')).toEqual({ latestVersion: 'unknown', allVersions: [] })
  })

  it('treats unrecognized errors as transient rather than failing the run', async () => {
    requestMock.mockRejectedValue(new Error('weird one-off failure'))

    const result = await fetchPackageVersions(['demo-pkg'])

    expect(requestMock).toHaveBeenCalledTimes(3)
    expect(result.get('demo-pkg')).toEqual({ latestVersion: 'unknown', allVersions: [] })
  })

  it('marks a package unknown when an error body fails to drain', async () => {
    poolRequestSpy.mockImplementationOnce(async () => {
      return {
        statusCode: 404,
        headers: {},
        trailers: {},
        opaque: null,
        context: {},
        body: {
          arrayBuffer: async () => Buffer.alloc(0),
          dump: async () => {
            throw new Error('drain failed')
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    })

    const result = await fetchPackageVersions(['demo-pkg'])

    expect(result.get('demo-pkg')).toEqual({ latestVersion: 'unknown', allVersions: [] })
  })

  it('decompresses gzip, brotli, and deflate bodies, including array headers', async () => {
    const payload = JSON.stringify({ versions: { '1.0.0': {}, '1.1.0': {} } })
    const encoded: Array<[string, Buffer]> = [
      ['gzip', gzipSync(payload)],
      ['br', brotliCompressSync(payload)],
      ['deflate', deflateSync(payload)],
    ]

    for (const [encoding, buffer] of encoded) {
      clearPackageCache()
      poolRequestSpy.mockImplementationOnce(async () => {
        return {
          statusCode: 200,
          // Array-valued header: undici surfaces repeated headers as arrays.
          headers: { 'content-encoding': [encoding] },
          trailers: {},
          opaque: null,
          context: {},
          body: { arrayBuffer: async () => buffer, dump: async () => {} },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      })

      const result = await fetchPackageVersions(['demo-pkg'])
      expect(result.get('demo-pkg')?.latestVersion).toBe('1.1.0')
    }
  })

  it('emits batched results in request order', async () => {
    requestMock.mockImplementation(async ({ path }) => {
      if (path.includes('pkg-a')) {
        return makeOkBody({ versions: { '1.0.0': {}, '1.1.0': {} } })
      }
      if (path.includes('pkg-b')) {
        return makeOkBody({ versions: { '2.0.0': {}, '2.1.0': {} } })
      }
      return makeOkBody({ versions: { '3.0.0': {}, '3.1.0': {} } })
    })

    const batches: string[][] = []
    const result = await fetchPackageVersions(['pkg-a', 'pkg-b', 'pkg-c'], {
      batchSize: 2,
      maxConcurrency: 1,
      onBatchReady: (batch) => {
        batches.push(batch.map((item) => item.packageName))
      },
    })

    expect(batches).toEqual([['pkg-a', 'pkg-b'], ['pkg-c']])
    expect(new Set(result.keys())).toEqual(new Set(['pkg-a', 'pkg-b', 'pkg-c']))
  })

  it('supports a growing batch-size sequence', async () => {
    requestMock.mockResolvedValue(makeOkBody({ versions: { '1.0.0': {}, '1.1.0': {} } }))

    const packageNames = Array.from({ length: 50 }, (_, index) => `pkg-${index + 1}`)
    const batches: number[] = []

    await fetchPackageVersions(packageNames, {
      batchSizes: [10, 15, 20, 25],
      maxConcurrency: 5,
      onBatchReady: (batch) => {
        batches.push(batch.length)
      },
    })

    expect(batches).toEqual([10, 15, 20, 5])
  })

  describe('adaptive concurrency', () => {
    // Instrument the mock to record the peak number of simultaneously in-flight
    // requests, with a small delay so requests actually overlap.
    const withConcurrencyTracking = (response: MockResponse) => {
      let inFlight = 0
      let peak = 0
      requestMock.mockImplementation(async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, response.delayMs ?? 5))
        inFlight--
        return response
      })
      return () => peak
    }

    const names = (n: number) => Array.from({ length: n }, (_, i) => `pkg-${i + 1}`)

    it('adaptive:false pins in-flight to maxConcurrency (the control arm)', async () => {
      const getPeak = withConcurrencyTracking(makeOkBody({ versions: { '1.0.0': {} } }))

      await fetchPackageVersions(names(40), {
        adaptive: false,
        maxConcurrency: 10,
      })

      expect(getPeak()).toBeLessThanOrEqual(10)
    })

    it('small runs (<= ceil) skip the controller — no control ticks', async () => {
      withConcurrencyTracking(makeOkBody({ versions: { '1.0.0': {} } }))
      const ticks: ControlTick[] = []

      await fetchPackageVersions(names(12), {
        adaptive: true,
        onControlTick: (t) => ticks.push(t),
      })

      expect(ticks).toHaveLength(0)
    })

    it('holds at the ceiling on a large, healthy, fast link', async () => {
      const getPeak = withConcurrencyTracking(makeOkBody({ versions: { '1.0.0': {} } }))
      const ticks: ControlTick[] = []

      await fetchPackageVersions(names(120), {
        adaptive: true,
        onControlTick: (t) => ticks.push(t),
      })

      expect(ticks.length).toBeGreaterThan(0)
      // A big run smart-starts at the ceiling, so the healthy steady state is to
      // hold there — never backing off (no oscillation), never exceeding the pool
      // ceiling. This is the regression guard: latency variance must NOT trigger
      // soft-downs on a healthy link.
      expect(ticks.every((t) => t.limit <= 24)).toBe(true)
      expect(ticks.some((t) => t.reason === 'hard-down')).toBe(false)
      expect(ticks.some((t) => t.reason === 'soft-down')).toBe(false)
      expect(getPeak()).toBeLessThanOrEqual(24)
    })

    it('does not oscillate under variable (but error-free) latency', async () => {
      // Alternate fast/slow responses to simulate the jittery npm CDN. With the
      // latency heuristic removed, this must NOT cause the controller to thrash.
      let i = 0
      requestMock.mockImplementation(async () => {
        const delayMs = i++ % 2 === 0 ? 1 : 25
        await new Promise((r) => setTimeout(r, delayMs))
        return makeOkBody({ versions: { '1.0.0': {} } })
      })
      const ticks: ControlTick[] = []

      await fetchPackageVersions(names(120), {
        adaptive: true,
        onControlTick: (t) => ticks.push(t),
      })

      // No back-off of any kind without real errors.
      expect(ticks.some((t) => t.reason === 'soft-down' || t.reason === 'hard-down')).toBe(false)
    })

    it('hard-backs-off on 429 congestion and honors Retry-After', async () => {
      const ticks: ControlTick[] = []
      // First batch of calls congest; later calls succeed. Use a short
      // Retry-After so the test stays fast (sleep is mocked, but the value still
      // routes through the congestion path).
      let calls = 0
      requestMock.mockImplementation(async ({ path }) => {
        calls++
        if (calls <= 30) {
          return {
            statusCode: 429,
            body: '',
            headers: { 'retry-after': '0' },
          }
        }
        void path
        return makeOkBody({ versions: { '1.0.0': {} } })
      })

      await fetchPackageVersions(names(60), {
        adaptive: true,
        onControlTick: (t) => ticks.push(t),
      })

      // Congestion must produce at least one immediate hard-down decision.
      expect(ticks.some((t) => t.reason === 'hard-down')).toBe(true)
    })

    it('records retryable outcomes with the controller and reports package timings', async () => {
      let calls = 0
      requestMock.mockImplementation(async () => {
        calls++
        if (calls <= 30) {
          return makeErrBody(500)
        }
        return makeOkBody({ versions: { '1.0.0': {} } })
      })
      const timed: string[] = []

      const result = await fetchPackageVersions(names(60), {
        adaptive: true,
        onPackageTiming: (name) => timed.push(name),
      })

      expect(result.size).toBe(60)
      expect(timed.length).toBeGreaterThan(0)
    })

    it('observes congested and not-found outcomes without a controller (small timed run)', async () => {
      // Small runs skip the adaptive controller entirely, but a provided
      // onPackageTiming still installs the observer; congestion then has no
      // new limit to apply and not-found outcomes fall through unrecorded.
      requestMock.mockImplementation(async ({ path }) => {
        if (path.includes('congested-pkg')) return makeErrBody(429)
        return makeErrBody(404)
      })
      const timed: string[] = []

      const result = await fetchPackageVersions(['congested-pkg', 'missing-pkg'], {
        adaptive: true,
        onPackageTiming: (name) => timed.push(name),
      })

      expect(result.get('congested-pkg')).toEqual({ latestVersion: 'unknown', allVersions: [] })
      expect(result.get('missing-pkg')).toEqual({ latestVersion: 'unknown', allVersions: [] })
      expect(timed).toHaveLength(0)
    })

    it('records transient outcomes with the controller', async () => {
      let calls = 0
      requestMock.mockImplementation(async () => {
        calls++
        if (calls % 5 === 0) {
          const error = new Error('connection reset')
          error.name = 'AbortError'
          throw error
        }
        return makeOkBody({ versions: { '1.0.0': {} } })
      })

      const result = await fetchPackageVersions(names(60), { adaptive: true })

      expect(result.size).toBe(60)
    })
  })

  describe('hill-climb wiring', () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `pkg-${i + 1}`)

    /**
     * A bandwidth-bound pipe: responses are serialized through a promise chain
     * at a fixed cost each, so total goodput is flat no matter how many
     * requests are in flight — exactly what a narrow link looks like.
     */
    const withBandwidthBoundPipe = (costMs: number) => {
      let chain = Promise.resolve()
      requestMock.mockImplementation(async () => {
        const my = chain.then(() => new Promise<void>((r) => setTimeout(r, costMs)))
        chain = my
        await my
        return makeOkBody({ versions: { '1.0.0': {} } })
      })
    }

    it('adapts DOWN on a bandwidth-bound link without any error signal', async () => {
      withBandwidthBoundPipe(8)
      const ticks: ControlTick[] = []

      const result = await fetchPackageVersions(names(100), {
        onControlTick: (t) => ticks.push(t),
      })

      expect(result.size).toBe(100)
      // Passive down-adaptation: the flat pipe must produce at least one
      // goodput-driven down decision — with zero 429s or network errors.
      expect(ticks.some((t) => t.reason === 'revert' || t.reason === 'step-down')).toBe(true)
      expect(ticks.some((t) => t.reason === 'hard-down' || t.reason === 'soft-down')).toBe(false)
      expect(ticks.at(-1)!.limit).toBeLessThanOrEqual(8)
    })

    it('reaches the ceiling by doubling on a fast link', async () => {
      let inFlight = 0
      let peak = 0
      // 20ms per response: large against scheduler noise, so window-over-window
      // goodput gains stay well above the doubling gate even under a loaded
      // test runner (real timers make this an inherently timing-based test).
      requestMock.mockImplementation(async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 20))
        inFlight--
        return makeOkBody({ versions: { '1.0.0': {} } })
      })
      const ticks: ControlTick[] = []

      await fetchPackageVersions(names(120), {
        onControlTick: (t) => ticks.push(t),
      })

      expect(ticks.filter((t) => t.reason === 'double').length).toBeGreaterThanOrEqual(2)
      expect(Math.max(...ticks.map((t) => t.limit))).toBeGreaterThanOrEqual(16)
      expect(peak).toBeLessThanOrEqual(24)
    })

    it('concurrency option pins the limit and disables the controller', async () => {
      let inFlight = 0
      let peak = 0
      requestMock.mockImplementation(async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return makeOkBody({ versions: { '1.0.0': {} } })
      })
      const ticks: ControlTick[] = []

      await fetchPackageVersions(names(40), {
        concurrency: 5,
        onControlTick: (t) => ticks.push(t),
      })

      expect(peak).toBeLessThanOrEqual(5)
      expect(ticks).toHaveLength(0)
    })

    it('starts from the injected network profile when the regime matches', async () => {
      requestMock.mockResolvedValue(makeOkBody({ versions: { '1.0.0': {} } }))
      const ticks: ControlTick[] = []

      await fetchPackageVersions(names(60), {
        networkProfile: {
          schemaVersion: 1,
          learnedLimit: 8,
          baselineLatencyMs: 100,
          baselineGoodputRps: 10,
          sampleCount: 100,
          updatedAt: new Date(0).toISOString(),
        },
        onControlTick: (t) => ticks.push(t),
      })

      // The first window runs (and reports) at the learned limit.
      expect(ticks[0].limit).toBeGreaterThanOrEqual(8)
    })

    it('uses the learned limit as the fixed start for runs too small to control', async () => {
      let inFlight = 0
      let peak = 0
      requestMock.mockImplementation(async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return makeOkBody({ versions: { '1.0.0': {} } })
      })
      const ticks: ControlTick[] = []

      await fetchPackageVersions(names(20), {
        networkProfile: {
          schemaVersion: 1,
          learnedLimit: 5,
          baselineLatencyMs: 100,
          baselineGoodputRps: 10,
          sampleCount: 100,
          updatedAt: new Date(0).toISOString(),
        },
        onControlTick: (t) => ticks.push(t),
      })

      expect(ticks).toHaveLength(0) // too small for the controller…
      expect(peak).toBeLessThanOrEqual(5) // …but the learned limit still caps the fixed start
    })

    it('emits a settled profile via onNetworkProfile once the run held', async () => {
      withBandwidthBoundPipe(8)
      const profiles: unknown[] = []

      await fetchPackageVersions(names(100), {
        onNetworkProfile: (p) => profiles.push(p),
      })

      expect(profiles).toHaveLength(1)
      const profile = profiles[0] as { schemaVersion: number; learnedLimit: number }
      expect(profile.schemaVersion).toBe(1)
      expect(profile.learnedLimit).toBeLessThanOrEqual(8)
    })

    it('does not emit a profile for runs too small to control', async () => {
      requestMock.mockResolvedValue(makeOkBody({ versions: { '1.0.0': {} } }))
      const profiles: unknown[] = []

      await fetchPackageVersions(names(12), {
        onNetworkProfile: (p) => profiles.push(p),
      })

      expect(profiles).toHaveLength(0)
    })

    it('controllerMode aimd selects the control arm (smart start at the ceiling)', async () => {
      requestMock.mockResolvedValue(makeOkBody({ versions: { '1.0.0': {} } }))
      const ticks: ControlTick[] = []

      await fetchPackageVersions(names(120), {
        controllerMode: 'aimd',
        onControlTick: (t) => ticks.push(t),
      })

      expect(ticks.length).toBeGreaterThan(0)
      expect(ticks[0].limit).toBe(24) // AIMD smart-starts at the ceiling
      expect(ticks.some((t) => t.reason === 'double')).toBe(false)
    })
  })

  describe('ETag conditional caching', () => {
    // Isolated root per test: never wipe (or race parallel test files on) the
    // user's real persistent cache directory.
    let etagTestRoot: string

    beforeEach(() => {
      etagTestRoot = mkdtempSync(join(tmpdir(), 'inup-npm-registry-etag-'))
      setEtagCacheRoot(etagTestRoot)
      setEtagCacheEnabled(true)
    })
    afterEach(() => {
      setEtagCacheRoot(null)
      setEtagCacheEnabled(false)
      rmSync(etagTestRoot, { recursive: true, force: true })
    })

    it('stores the ETag on a 200 and reuses data on a subsequent 304', async () => {
      // First run: 200 with an ETag and a body → stores {etag, data}.
      requestMock.mockImplementation(async () => ({
        statusCode: 200,
        body: JSON.stringify({ versions: { '1.0.0': {}, '1.1.0': {} } }),
        headers: { etag: 'W/"v1"' },
      }))
      const first = await fetchPackageVersions(['demo-pkg'])
      expect(first.get('demo-pkg')).toEqual({
        latestVersion: '1.1.0',
        allVersions: ['1.1.0', '1.0.0'],
      })

      // Second run: registry validates the stored ETag → 304 with no body. The
      // stored data must be reused (no re-parse of a body that isn't there).
      let sentIfNoneMatch: string | undefined
      requestMock.mockReset()
      poolRequestSpy.mockImplementationOnce(async (opts: unknown) => {
        const o = opts as { path: string; headers: Record<string, string> }
        sentIfNoneMatch = o.headers['if-none-match']
        return {
          statusCode: 304,
          headers: {},
          trailers: {},
          opaque: null,
          context: {},
          body: { arrayBuffer: async () => Buffer.alloc(0), dump: async () => {} },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      })
      clearPackageCache() // clear in-run dedupe so the 2nd call really fetches

      const second = await fetchPackageVersions(['demo-pkg'])
      expect(sentIfNoneMatch).toBe('W/"v1"') // conditional header was sent
      expect(second.get('demo-pkg')).toEqual({
        latestVersion: '1.1.0',
        allVersions: ['1.1.0', '1.0.0'],
      })
    })

    it('still issues a request every run (304 = validated, never stale-without-checking)', async () => {
      requestMock.mockImplementation(async () => ({
        statusCode: 200,
        body: JSON.stringify({ versions: { '1.0.0': {} } }),
        headers: { etag: 'W/"x"' },
      }))
      await fetchPackageVersions(['demo-pkg'])
      const callsAfterFirst = poolRequestSpy.mock.calls.length
      clearPackageCache()
      await fetchPackageVersions(['demo-pkg'])
      // A second run hits the network again (freshness), not served purely offline.
      expect(poolRequestSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst)
    })

    it('stores an array-valued ETag header and reuses data on 304 despite a failing drain', async () => {
      poolRequestSpy.mockImplementationOnce(async () => {
        return {
          statusCode: 200,
          headers: { etag: ['W/"array-form"'] },
          trailers: {},
          opaque: null,
          context: {},
          body: {
            arrayBuffer: async () =>
              Buffer.from(JSON.stringify({ versions: { '1.0.0': {}, '1.1.0': {} } }), 'utf8'),
            dump: async () => {},
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      })
      const first = await fetchPackageVersions(['demo-pkg'])
      expect(first.get('demo-pkg')?.latestVersion).toBe('1.1.0')

      clearPackageCache()
      let sentIfNoneMatch: string | undefined
      poolRequestSpy.mockImplementationOnce(async (opts: unknown) => {
        const o = opts as { headers: Record<string, string> }
        sentIfNoneMatch = o.headers['if-none-match']
        return {
          statusCode: 304,
          headers: {},
          trailers: {},
          opaque: null,
          context: {},
          body: {
            arrayBuffer: async () => Buffer.alloc(0),
            // Draining the empty 304 body may itself fail; the cached data
            // must still be served.
            dump: async () => {
              throw new Error('drain failed')
            },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      })

      const second = await fetchPackageVersions(['demo-pkg'])
      expect(sentIfNoneMatch).toBe('W/"array-form"')
      expect(second.get('demo-pkg')?.latestVersion).toBe('1.1.0')
    })

    it('scopes cached ETags by registry origin — no cross-registry reuse', async () => {
      // Store an ETag for demo-pkg on origin A.
      registryTargetMock.mockReturnValueOnce({
        origin: 'https://registry-a.example.com',
        pathPrefix: '',
      })
      requestMock.mockImplementation(async () => ({
        statusCode: 200,
        body: JSON.stringify({ versions: { '1.0.0': {} } }),
        headers: { etag: 'W/"origin-a"' },
      }))
      await fetchPackageVersions(['demo-pkg'])

      // The same registry path on origin B must NOT validate against origin
      // A's cached ETag: keys are origin-qualified.
      clearPackageCache()
      registryTargetMock.mockReturnValueOnce({
        origin: 'https://registry-b.example.com',
        pathPrefix: '',
      })
      let sentIfNoneMatch: string | undefined = 'not-captured'
      poolRequestSpy.mockImplementationOnce(async (opts: unknown) => {
        const o = opts as { headers: Record<string, string> }
        sentIfNoneMatch = o.headers['if-none-match']
        return {
          statusCode: 200,
          headers: {},
          trailers: {},
          opaque: null,
          context: {},
          body: {
            arrayBuffer: async () =>
              Buffer.from(JSON.stringify({ versions: { '2.0.0': {} } }), 'utf8'),
            dump: async () => {},
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      })

      const result = await fetchPackageVersions(['demo-pkg'])

      expect(sentIfNoneMatch).toBeUndefined()
      expect(result.get('demo-pkg')?.latestVersion).toBe('2.0.0')
    })
  })
})
