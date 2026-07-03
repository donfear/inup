import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Pool } from 'undici'

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

import {
  clearPackageCache,
  fetchPackageVersions,
} from '../../../../src/shared/registry/npm-registry'
import type { ControlTick } from '../../../../src/shared/http/adaptive-controller'
import { setEtagCacheEnabled, etagCacheDir } from '../../../../src/shared/http/etag-store'
import { rmSync } from 'node:fs'

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
    expect(opts.headers['authorization']).toBeUndefined()
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
    expect(opts.headers['authorization']).toBe('Bearer sekret')
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
  })

  describe('ETag conditional caching', () => {
    beforeEach(() => {
      setEtagCacheEnabled(true)
      rmSync(etagCacheDir(), { recursive: true, force: true })
    })
    afterEach(() => setEtagCacheEnabled(false))

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
