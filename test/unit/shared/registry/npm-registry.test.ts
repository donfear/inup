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

// Every JS-transport request goes through this mock (see requestSpy below).
const { requestSpy } = vi.hoisted(() => ({
  requestSpy: vi.fn<(opts: unknown) => Promise<unknown>>(),
}))
vi.mock('../../../../src/shared/http/http-request', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/shared/http/http-request')>()),
  httpRequest: (origin: string, opts: object) => requestSpy({ origin, ...opts }),
}))

// The optional Rust core is off unless a test hands out a decoder or transport.
const { packumentDecoderMock, nativeTransportMock } = vi.hoisted(() => ({
  packumentDecoderMock: vi.fn((): unknown => null),
  nativeTransportMock: vi.fn((): unknown => null),
}))
vi.mock('../../../../src/shared/registry/rust-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/shared/registry/rust-core')>()),
  packumentDecoder: packumentDecoderMock,
  nativeTransport: nativeTransportMock,
}))

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { debugLog } from '../../../../src/shared/debug-logger'
import {
  readEtag,
  setEtagCacheEnabled,
  setEtagCacheRoot,
} from '../../../../src/shared/http/etag-store'
import type { ControlTick } from '../../../../src/shared/http/hill-climb-controller'
import { sleep } from '../../../../src/shared/http/retry'
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
  /** When set, the body is also async-iterable and streams exactly these chunks. */
  chunks?: Buffer[]
}

const makeOkBody = (json: unknown): MockResponse => ({
  statusCode: 200,
  body: JSON.stringify(json),
})

/** A streamed response body yielding `buffer` as one chunk (none when empty). */
const streamOf = (buffer: Buffer) => ({
  [Symbol.asyncIterator]: async function* () {
    if (buffer.length > 0) yield buffer
  },
})

const makeErrBody = (statusCode: number): MockResponse => ({
  statusCode,
  body: '',
})

describe('npm-registry', () => {
  const requestMock = vi.fn<(opts: { path: string }) => Promise<MockResponse>>()

  // Responses have the shape httpRequest resolves: status, headers and a
  // streamed body (the test's chunks, or the whole body as one chunk).
  const poolRequestSpy = requestSpy
  const defaultRequest = async (opts: unknown) => {
    const { path } = opts as { path: string }
    const response = await requestMock({ path })
    if (response.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, response.delayMs))
    }
    const chunks = response.chunks ?? [Buffer.from(response.body, 'utf8')]
    return {
      statusCode: response.statusCode,
      headers: response.headers ?? {},
      body: {
        dump: async () => {},
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) yield chunk
        },
      },
    }
  }
  poolRequestSpy.mockImplementation(defaultRequest)

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
      prereleaseVersions: ['2.0.0-beta.1'],
    })
  })

  it('cancels active requests and skips queued packages without retrying', async () => {
    const controller = new AbortController()
    poolRequestSpy.mockImplementationOnce(
      (opts: any) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true })
          controller.abort(new Error('cancelled'))
        }) as any
    )
    const pending = fetchPackageVersions(['active', 'queued'], {
      concurrency: 1,
      signal: controller.signal,
    })
    await expect(pending).rejects.toThrow('cancelled')
    expect(poolRequestSpy).toHaveBeenCalledTimes(1)
  })

  it('cancels a retry wait instead of retrying the package', async () => {
    const controller = new AbortController()
    requestMock.mockImplementation(async () => {
      setImmediate(() => controller.abort(new Error('cancel retry')))
      return makeErrBody(503)
    })
    await expect(fetchPackageVersions(['retry'], { signal: controller.signal })).rejects.toThrow()
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('resolves cancellable requests normally and never publishes a result after cancellation', async () => {
    requestMock.mockResolvedValue(makeOkBody({ versions: { '1.0.0': {} } }))
    const controller = new AbortController()
    const result = await fetchPackageVersions(['first'], { signal: controller.signal })
    expect(result.get('first')?.latestVersion).toBe('1.0.0')
    const ready = vi.fn()
    await expect(
      fetchPackageVersions(['second'], {
        signal: controller.signal,
        onPackageTiming: () => controller.abort(new Error('cancel before publication')),
        onPackageReady: ready,
      })
    ).rejects.toThrow('cancel before publication')
    expect(ready).not.toHaveBeenCalled()
  })

  it('sends no authorization header when the registry has no credentials', async () => {
    requestMock.mockResolvedValue(makeOkBody({ versions: { '1.0.0': {} } }))

    await fetchPackageVersions(['demo-pkg'])

    const opts = poolRequestSpy.mock.calls[0][0] as { headers: Record<string, string> }
    expect(opts.headers.authorization).toBeUndefined()
  })

  it('requests the abbreviated packument by default', async () => {
    requestMock.mockResolvedValue(makeOkBody({ versions: { '1.0.0': {} } }))

    await fetchPackageVersions(['demo-pkg'])

    const opts = poolRequestSpy.mock.calls[0][0] as { headers: Record<string, string> }
    expect(opts.headers.accept).toBe('application/vnd.npm.install-v1+json')
  })

  it('fullMetadata requests the full packument and surfaces publish times', async () => {
    requestMock.mockResolvedValue(
      makeOkBody({
        versions: { '1.0.0': {}, '1.1.0': {} },
        time: {
          created: '2020-01-01T00:00:00.000Z',
          '1.0.0': '2020-01-01T00:00:00.000Z',
          '1.1.0': '2024-01-02T00:00:00.000Z',
        },
      })
    )

    const result = await fetchPackageVersions(['demo-pkg'], { fullMetadata: true })

    const opts = poolRequestSpy.mock.calls[0][0] as { headers: Record<string, string> }
    expect(opts.headers.accept).toBe('application/json')
    expect(result.get('demo-pkg')).toMatchObject({
      latestVersion: '1.1.0',
      publishTimes: {
        '1.0.0': '2020-01-01T00:00:00.000Z',
        '1.1.0': '2024-01-02T00:00:00.000Z',
      },
    })
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
      prereleaseVersions: [],
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
      prereleaseVersions: [],
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
        body: {
          ...streamOf(Buffer.alloc(0)),
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
          // Array-valued header: repeated headers can arrive as arrays.
          headers: { 'content-encoding': [encoding] },
          body: { ...streamOf(buffer), dump: async () => {} },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      })

      const result = await fetchPackageVersions(['demo-pkg'])
      expect(result.get('demo-pkg')?.latestVersion).toBe('1.1.0')
    }
  })

  it('emits every package exactly once with its own data', async () => {
    requestMock.mockImplementation(async ({ path }) => {
      const major = path.endsWith('pkg-a') ? 1 : path.endsWith('pkg-b') ? 2 : 3
      return makeOkBody({ versions: { [`${major}.0.0`]: {}, [`${major}.1.0`]: {} } })
    })

    const emitted: Array<[string, string]> = []
    const result = await fetchPackageVersions(['pkg-a', 'pkg-b', 'pkg-c'], {
      onPackageReady: ({ packageName, data }) => emitted.push([packageName, data.latestVersion]),
    })

    expect(emitted).toEqual([
      ['pkg-a', '1.1.0'],
      ['pkg-b', '2.1.0'],
      ['pkg-c', '3.1.0'],
    ])
    expect(Array.from(result.keys())).toEqual(['pkg-a', 'pkg-b', 'pkg-c'])
  })

  it('emits each package the moment it resolves; a slow earlier package holds nothing back', async () => {
    const pending = new Map<string, (response: MockResponse) => void>()
    requestMock.mockImplementation(
      ({ path }) =>
        new Promise((resolve) => {
          pending.set(path, resolve)
        })
    )
    const emitted: string[] = []
    const run = fetchPackageVersions(['a', 'b', 'c'], {
      onPackageReady: ({ packageName }) => emitted.push(packageName),
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(Array.from(pending.keys()).sort()).toEqual(['/a', '/b', '/c'])

    pending.get('/c')!(makeOkBody({ versions: { '3.0.0': {} } }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(emitted).toEqual(['c'])

    pending.get('/b')!(makeErrBody(404))
    await new Promise((resolve) => setImmediate(resolve))
    expect(emitted).toEqual(['c', 'b'])

    pending.get('/a')!(makeOkBody({ versions: { '1.0.0': {} } }))
    const result = await run
    expect(emitted).toEqual(['c', 'b', 'a'])
    expect(result.get('b')?.latestVersion).toBe('unknown')
    expect(result.get('c')?.latestVersion).toBe('3.0.0')
  })

  it('fails the run on a throwing consumer and never emits that package twice', async () => {
    requestMock.mockImplementation(async ({ path }) =>
      makeOkBody({ versions: { [path.endsWith('/a') ? '1.0.0' : '2.0.0']: {} } })
    )
    const emitted: string[] = []
    const run = fetchPackageVersions(['a', 'b', 'c'], {
      onPackageReady: ({ packageName }) => {
        emitted.push(packageName)
        if (packageName === 'a') throw new Error('consumer failed')
      },
    })

    await expect(run).rejects.toThrow('consumer failed')
    await new Promise((resolve) => setImmediate(resolve))
    expect(emitted.filter((name) => name === 'a')).toHaveLength(1)
  })

  it('emits a retried package once, after its retry succeeds', async () => {
    let attemptsForA = 0
    requestMock.mockImplementation(async ({ path }) => {
      if (path.endsWith('/a')) {
        attemptsForA++
        return attemptsForA === 1
          ? makeErrBody(500)
          : makeOkBody({ versions: { '1.0.0': {}, '1.5.0': {} } })
      }
      return makeOkBody({ versions: { '2.0.0': {} } })
    })

    const emitted: Array<[string, string]> = []
    await fetchPackageVersions(['a', 'b'], {
      onPackageReady: ({ packageName, data }) => emitted.push([packageName, data.latestVersion]),
    })

    expect(attemptsForA).toBe(2)
    // b resolves on its first attempt, so it lands before a's retry completes.
    expect(emitted).toEqual([
      ['b', '2.0.0'],
      ['a', '1.5.0'],
    ])
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

    it('small runs (<= ceil) skip the controller — no control ticks', async () => {
      withConcurrencyTracking(makeOkBody({ versions: { '1.0.0': {} } }))
      const ticks: ControlTick[] = []

      await fetchPackageVersions(names(12), {
        onControlTick: (t) => ticks.push(t),
      })

      expect(ticks).toHaveLength(0)
    })

    it('holds at the ceiling on a large, healthy, fast link', async () => {
      const getPeak = withConcurrencyTracking(makeOkBody({ versions: { '1.0.0': {} } }))
      const ticks: ControlTick[] = []

      await fetchPackageVersions(names(120), {
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

      const result = await fetchPackageVersions(names(60))

      expect(result.size).toBe(60)
    })
  })

  describe('hill-climb wiring', () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `pkg-${i + 1}`)

    // The whole block runs on a virtual clock: mock latencies are fake-timer
    // milliseconds, so window goodput — and therefore every controller
    // decision — is exact and load-independent. Real timers made these tests
    // flake under coverage instrumentation.
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    /** Start the fetch, drain the virtual clock, return the result. */
    const runFetch = async (
      packageNames: string[],
      options: Parameters<typeof fetchPackageVersions>[1]
    ) => {
      const done = fetchPackageVersions(packageNames, options)
      await vi.runAllTimersAsync()
      return await done
    }

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

    /** A fast, wide link: fixed per-response latency, unlimited parallelism. */
    const withFastLink = (latencyMs: number) => {
      let inFlight = 0
      let peak = 0
      requestMock.mockImplementation(async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, latencyMs))
        inFlight--
        return makeOkBody({ versions: { '1.0.0': {} } })
      })
      return () => peak
    }

    it('adapts DOWN on a bandwidth-bound link without any error signal', async () => {
      withBandwidthBoundPipe(8)
      const ticks: ControlTick[] = []

      const result = await runFetch(names(100), {
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
      const getPeak = withFastLink(20)
      const ticks: ControlTick[] = []

      await runFetch(names(120), {
        onControlTick: (t) => ticks.push(t),
      })

      // Virtual clock: 12-completion windows at limits 4/8/16 take exactly
      // 60/40/20 fake-ms → gains 1.5 and 2.0 clear the doubling gate every time.
      expect(ticks.filter((t) => t.reason === 'double').length).toBeGreaterThanOrEqual(2)
      expect(Math.max(...ticks.map((t) => t.limit))).toBe(24)
      expect(getPeak()).toBeLessThanOrEqual(24)
    })

    /** A wide link streaming big packuments: one `bytes`-long chunk per response. */
    const withStreamedBigBodies = (latencyMs: number, bytes: number) => {
      const pad = 'x'.repeat(bytes)
      const json = JSON.stringify({ versions: { '1.0.0': {} }, pad })
      requestMock.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, latencyMs))
        return { statusCode: 200, body: json, chunks: [Buffer.from(json, 'utf8')] }
      })
    }

    it('streams response bytes into the controller so a wide pipe engages fast link', async () => {
      // 100 KB per response at 20 fake-ms: 12-completion windows stream ≥ 1.2 MB
      // in 60 ms — far above the 1 MB/s fast-link bar.
      withStreamedBigBodies(20, 100_000)
      const ticks: ControlTick[] = []

      const result = await runFetch(names(60), { onControlTick: (t) => ticks.push(t) })

      expect(result.size).toBe(60)
      expect(ticks[0]).toMatchObject({ limit: 24, fastLink: true })
      expect(ticks[0].goodputBps).toBeGreaterThan(1_000_000)
      expect(ticks.some((t) => t.reason === 'revert' || t.reason === 'step-down')).toBe(false)
    })

    it('concurrency option pins the limit and disables the controller', async () => {
      const getPeak = withFastLink(5)
      const ticks: ControlTick[] = []

      await runFetch(names(40), {
        concurrency: 5,
        onControlTick: (t) => ticks.push(t),
      })

      expect(getPeak()).toBeLessThanOrEqual(5)
      expect(ticks).toHaveLength(0)
    })

    it('starts from the injected network profile when the regime matches', async () => {
      withFastLink(5)
      const ticks: ControlTick[] = []

      await runFetch(names(60), {
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
      const getPeak = withFastLink(5)
      const ticks: ControlTick[] = []

      await runFetch(names(20), {
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
      expect(getPeak()).toBeLessThanOrEqual(5) // …but the learned limit still caps the fixed start
    })

    it('emits a settled profile via onNetworkProfile once the run held', async () => {
      withBandwidthBoundPipe(8)
      const profiles: unknown[] = []

      await runFetch(names(100), {
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

      await runFetch(names(12), {
        onNetworkProfile: (p) => profiles.push(p),
      })

      expect(profiles).toHaveLength(0)
    })

    it('survives a mid-run blackout: completes, backs off, reports partial results', async () => {
      // Simulated disconnect/reconnect: calls 41-100 all fail with a transient
      // network error (every retry attempt included), then the link is back.
      let calls = 0
      requestMock.mockImplementation(async () => {
        calls++
        if (calls > 40 && calls <= 100) {
          const error = new Error('socket hang up')
          error.name = 'AbortError'
          throw error
        }
        await new Promise((r) => setTimeout(r, 3))
        return makeOkBody({ versions: { '1.0.0': {} } })
      })
      const ticks: ControlTick[] = []

      const result = await runFetch(names(80), {
        onControlTick: (t) => ticks.push(t),
      })

      // Every package gets an answer — the run never hangs or throws.
      expect(result.size).toBe(80)
      const unavailable = [...result.values()].filter((v) => v.latestVersion === 'unknown')
      // A partial outage, visibly partial: some packages exhausted their
      // retries during the blackout, the rest resolved after the reconnect.
      expect(unavailable.length).toBeGreaterThan(0)
      expect(unavailable.length).toBeLessThan(80)
      // The controller backed off on the transient errors — no 429 needed.
      expect(ticks.some((t) => t.reason === 'soft-down')).toBe(true)
      expect(ticks.some((t) => t.reason === 'hard-down')).toBe(false)
    })

    it('applies a failed profile validation to the semaphore immediately', async () => {
      // 600 fake-ms per response against a 10ms baseline: the regime check
      // fails on the 8th success and the returned cold-start limit must reach
      // the semaphore through the success path of the observer.
      const getPeak = withFastLink(600)
      const ticks: ControlTick[] = []

      const result = await runFetch(names(60), {
        networkProfile: {
          schemaVersion: 1,
          learnedLimit: 24,
          baselineLatencyMs: 10,
          baselineGoodputRps: 100,
          sampleCount: 100,
          updatedAt: new Date(0).toISOString(),
        },
        onControlTick: (t) => ticks.push(t),
      })

      expect(result.size).toBe(60)
      expect(ticks.some((t) => t.reason === 'regime-reset')).toBe(true)
      expect(getPeak()).toBeLessThanOrEqual(24)
    })

    it('emits no profile when congestion never lets the run settle', async () => {
      // A 429 storm through the whole run: the controller keeps hard-halving,
      // so whatever limit it ends on is a back-off artifact, not a profile.
      let calls = 0
      requestMock.mockImplementation(async () => {
        calls++
        if (calls % 4 === 0) {
          return { statusCode: 429, body: '', headers: { 'retry-after': '0' } }
        }
        await new Promise((r) => setTimeout(r, 3))
        return makeOkBody({ versions: { '1.0.0': {} } })
      })
      const profiles: unknown[] = []
      const ticks: ControlTick[] = []

      await runFetch(names(60), {
        onNetworkProfile: (p) => profiles.push(p),
        onControlTick: (t) => ticks.push(t),
      })

      expect(ticks.some((t) => t.reason === 'hard-down')).toBe(true)
      expect(profiles).toHaveLength(0)
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
        prereleaseVersions: [],
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
          body: { ...streamOf(Buffer.alloc(0)), dump: async () => {} },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      })
      clearPackageCache() // clear in-run dedupe so the 2nd call really fetches

      const second = await fetchPackageVersions(['demo-pkg'])
      expect(sentIfNoneMatch).toBe('W/"v1"') // conditional header was sent
      expect(second.get('demo-pkg')).toEqual({
        latestVersion: '1.1.0',
        allVersions: ['1.1.0', '1.0.0'],
        prereleaseVersions: [],
      })
    })

    describe('with a release-age cooldown (fullMetadata)', () => {
      const fullBody = {
        versions: { '1.0.0': {}, '1.1.0': {} },
        time: {
          created: '2020-01-01T00:00:00.000Z',
          '1.0.0': '2020-01-01T00:00:00.000Z',
          '1.1.0': '2024-01-02T00:00:00.000Z',
        },
      }

      it('restores the publish times from the cache on a 304, so warm runs still gate', async () => {
        // The cooldown is only as good as its evidence. If a revalidated packument came
        // back without `time`, every warm run would silently report the cooldown inert.
        requestMock.mockImplementation(async () => ({
          statusCode: 200,
          body: JSON.stringify(fullBody),
          headers: { etag: 'W/"full-1"' },
        }))
        const first = await fetchPackageVersions(['demo-pkg'], { fullMetadata: true })
        expect(first.get('demo-pkg')?.publishTimes).toEqual({
          '1.0.0': '2020-01-01T00:00:00.000Z',
          '1.1.0': '2024-01-02T00:00:00.000Z',
        })

        let sentIfNoneMatch: string | undefined
        requestMock.mockReset()
        poolRequestSpy.mockImplementationOnce(async (opts: unknown) => {
          const o = opts as { headers: Record<string, string> }
          sentIfNoneMatch = o.headers['if-none-match']
          return {
            statusCode: 304,
            headers: {},
            body: { ...streamOf(Buffer.alloc(0)), dump: async () => {} },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any
        })
        clearPackageCache()

        const second = await fetchPackageVersions(['demo-pkg'], { fullMetadata: true })

        expect(sentIfNoneMatch).toBe('W/"full-1"')
        expect(second.get('demo-pkg')?.publishTimes).toEqual({
          '1.0.0': '2020-01-01T00:00:00.000Z',
          '1.1.0': '2024-01-02T00:00:00.000Z',
        })
      })

      it('never revalidates a full request against an abbreviated cache entry', async () => {
        // The two formats parse to different data. A 304 answered from the wrong entry
        // would hand a cooldown run a body that never had `time` in it.
        requestMock.mockImplementation(async () => ({
          statusCode: 200,
          body: JSON.stringify({ versions: { '1.0.0': {}, '1.1.0': {} } }),
          headers: { etag: 'W/"abbreviated"' },
        }))
        await fetchPackageVersions(['demo-pkg'])

        clearPackageCache()
        requestMock.mockImplementation(async () => ({
          statusCode: 200,
          body: JSON.stringify(fullBody),
          headers: { etag: 'W/"full"' },
        }))
        poolRequestSpy.mockClear()

        const full = await fetchPackageVersions(['demo-pkg'], { fullMetadata: true })

        const opts = poolRequestSpy.mock.calls[0][0] as { headers: Record<string, string> }
        expect(opts.headers.accept).toBe('application/json')
        expect(opts.headers['if-none-match']).toBeUndefined()
        expect(full.get('demo-pkg')?.publishTimes).toBeDefined()
        // And the abbreviated entry is still there, under its own key.
        expect(readEtag('https://registry.npmjs.org/demo-pkg')?.etag).toBe('W/"abbreviated"')
        expect(readEtag('https://registry.npmjs.org/demo-pkg#full')?.etag).toBe('W/"full"')
      })

      it('bypasses the native transport, which can only ask for the abbreviated document', async () => {
        // The addon hardcodes the install-v1 accept header and its parser drops `time`.
        // Using it for a cooldown run would lose the field the policy depends on.
        const fetch = vi.fn(async () => {
          throw new Error('the native transport must not be used for a full packument')
        })
        nativeTransportMock.mockReturnValue({ fetch, takeReceivedBytes: vi.fn(() => 0) })
        requestMock.mockImplementation(async () => ({
          statusCode: 200,
          body: JSON.stringify(fullBody),
        }))

        const result = await fetchPackageVersions(['demo-pkg'], { fullMetadata: true })

        expect(fetch).not.toHaveBeenCalled()
        expect(result.get('demo-pkg')?.publishTimes).toBeDefined()
        nativeTransportMock.mockReset()
        nativeTransportMock.mockReturnValue(null)
      })

      it('bypasses the Rust decoder, whose parsed shape has no publish times', async () => {
        const decode = vi.fn(async () => ({
          latestVersion: '1.1.0',
          allVersions: ['1.1.0', '1.0.0'],
          prereleaseVersions: [],
        }))
        packumentDecoderMock.mockReturnValue(decode)
        requestMock.mockImplementation(async () => ({
          statusCode: 200,
          body: JSON.stringify(fullBody),
          headers: { 'content-encoding': 'identity' },
        }))

        const result = await fetchPackageVersions(['demo-pkg'], { fullMetadata: true })

        expect(decode).not.toHaveBeenCalled()
        expect(result.get('demo-pkg')?.publishTimes).toBeDefined()
        packumentDecoderMock.mockReset()
        packumentDecoderMock.mockReturnValue(null)
      })
    })

    describe('with the native transport', () => {
      type Outcome = Record<string, unknown>
      const data = {
        latestVersion: '2.0.0',
        allVersions: ['2.0.0', '1.0.0'],
        prereleaseVersions: [],
      }
      const outcome = (overrides: Outcome): Outcome => ({
        kind: 'success',
        dataJson: JSON.stringify({ ...data, deprecated: null, enginesNode: null }),
        revalidated: false,
        bytes: 1234,
        latencyMs: 12.6,
        status: 200,
        ...overrides,
      })
      const useTransport = (...results: Outcome[]) => {
        const fetch = vi.fn(async (_request: unknown, _signal?: AbortSignal) => {
          const next = results.length > 1 ? results.shift() : results[0]
          return next as Outcome
        })
        const takeReceivedBytes = vi.fn(() => 0)
        nativeTransportMock.mockReturnValue({ fetch, takeReceivedBytes })
        return { fetch, takeReceivedBytes }
      }

      afterEach(() => {
        nativeTransportMock.mockReset()
        nativeTransportMock.mockReturnValue(null)
      })

      it('sends the whole attempt to Rust: URL, credentials and the cache file', async () => {
        registryTargetMock.mockReturnValueOnce({
          origin: 'https://npm.example.com',
          pathPrefix: '/artifactory/api/npm',
          authHeader: 'Bearer secret',
        })
        const { fetch } = useTransport(outcome({}))
        requestMock.mockImplementation(async () => {
          throw new Error('the JS transport must not be used')
        })

        const result = await fetchPackageVersions(['@scope/pkg'])

        expect(result.get('@scope/pkg')).toEqual({
          ...data,
          deprecated: undefined,
          enginesNode: undefined,
        })
        const [request] = fetch.mock.calls[0] as [Record<string, string>]
        expect(request.url).toBe('https://npm.example.com/artifactory/api/npm/@scope/pkg')
        expect(request.authorization).toBe('Bearer secret')
        expect(request.cacheFile.startsWith(etagTestRoot)).toBe(true)
        expect(requestMock).not.toHaveBeenCalled()
      })

      it('skips the cache file when the ETag store is disabled', async () => {
        setEtagCacheEnabled(false)
        const { fetch } = useTransport(outcome({}))
        await fetchPackageVersions(['demo-pkg'])
        expect((fetch.mock.calls[0][0] as { cacheFile: unknown }).cacheFile).toBeNull()
      })

      it('retries congested and retryable native outcomes, honoring Retry-After', async () => {
        vi.mocked(sleep).mockClear()
        const { fetch } = useTransport(
          outcome({ kind: 'congested', status: 429, retryAfter: '2' }),
          outcome({ kind: 'retryable', status: 500 }),
          outcome({ kind: 'success', revalidated: true, bytes: 0, status: 304 })
        )
        const result = await fetchPackageVersions(['demo-pkg'])

        expect(fetch).toHaveBeenCalledTimes(3)
        expect(vi.mocked(sleep).mock.calls[0]).toEqual([2000])
        expect(result.get('demo-pkg')?.latestVersion).toBe('2.0.0')
      })

      it('uses the default backoff when a congested response has no Retry-After', async () => {
        vi.mocked(sleep).mockClear()
        useTransport(
          outcome({ kind: 'congested', status: 503, retryAfter: null }),
          outcome({ kind: 'success' })
        )
        const result = await fetchPackageVersions(['demo-pkg'])
        expect(vi.mocked(sleep).mock.calls[0]).toEqual([500])
        expect(result.get('demo-pkg')?.latestVersion).toBe('2.0.0')
      })

      it('reports not-found and exhausted transient outcomes as unavailable', async () => {
        const notFound = useTransport(outcome({ kind: 'not-found', status: 404 }))
        const missing = await fetchPackageVersions(['missing-pkg'])
        expect(notFound.fetch).toHaveBeenCalledTimes(1)

        const transient = useTransport(outcome({ kind: 'transient', errorClass: 'connect' }))
        const down = await fetchPackageVersions(['down-pkg'])
        expect(transient.fetch).toHaveBeenCalledTimes(3)

        expect(missing.get('missing-pkg')).toEqual({ latestVersion: 'unknown', allVersions: [] })
        expect(down.get('down-pkg')).toEqual({ latestVersion: 'unknown', allVersions: [] })
      })

      it('reports native success latency, rounded', async () => {
        const seen: number[] = []
        useTransport(outcome({ latencyMs: 40.4 }))
        await fetchPackageVersions(['demo-pkg'], {
          onPackageTiming: (_name, latencyMs) => seen.push(latencyMs),
        })
        expect(seen).toEqual([40])
      })

      it('redoes the attempt with the JS transport and pins the origin after a fallback outcome', async () => {
        const warn = vi.spyOn(debugLog, 'warn').mockImplementation(() => {})
        const { fetch } = useTransport(
          outcome({ kind: 'fallback', errorClass: 'tls', error: 'UnknownIssuer' })
        )
        requestMock.mockImplementation(async () => makeOkBody({ versions: { '1.0.0': {} } }))

        const first = await fetchPackageVersions(['demo-pkg'])
        const second = await fetchPackageVersions(['other-pkg'])

        expect(first.get('demo-pkg')?.latestVersion).toBe('1.0.0')
        expect(second.get('other-pkg')?.latestVersion).toBe('1.0.0')
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(requestMock).toHaveBeenCalledTimes(2)
        expect(warn).toHaveBeenCalledWith(
          'npm-registry',
          expect.stringContaining('(tls), using the JS transport'),
          'UnknownIssuer'
        )
        warn.mockRestore()
      })

      it('turns a cancelled attempt into the abort error of the run', async () => {
        const controller = new AbortController()
        const { fetch } = useTransport(outcome({ kind: 'cancelled' }))
        fetch.mockImplementationOnce(async () => {
          controller.abort()
          return outcome({ kind: 'cancelled' })
        })
        await expect(
          fetchPackageVersions(['demo-pkg'], { signal: controller.signal })
        ).rejects.toThrow()
        expect(fetch.mock.calls[0][1]).toBe(controller.signal)
      })

      it('treats a cancel without an aborted signal as a transient failure', async () => {
        useTransport(outcome({ kind: 'cancelled' }))
        const result = await fetchPackageVersions(['demo-pkg'])
        expect(result.get('demo-pkg')?.latestVersion).toBe('unknown')
      })

      it('feeds natively streamed bytes to the adaptive controller', async () => {
        // Virtual time, as in the hill-climb wiring tests: the controller
        // discards zero-length windows, which instant fakes would produce.
        vi.useFakeTimers()
        try {
          const { fetch, takeReceivedBytes } = useTransport(outcome({}))
          fetch.mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5))
            return outcome({})
          })
          takeReceivedBytes.mockReturnValue(4096)
          const ticks: ControlTick[] = []

          const done = fetchPackageVersions(
            Array.from({ length: 60 }, (_, i) => `pkg-${i + 1}`),
            { onControlTick: (tick) => ticks.push(tick) }
          )
          await vi.runAllTimersAsync()
          await done

          expect(takeReceivedBytes).toHaveBeenCalled()
          expect(ticks.length).toBeGreaterThan(0)
          // Cold windows are measured in streamed bytes/sec: the native bytes arrived.
          expect(ticks[0].goodputBps).toBeGreaterThan(0)
        } finally {
          vi.useRealTimers()
        }
      })
    })

    describe('with the Rust core enabled', () => {
      const parsed = { latestVersion: '3.0.0', allVersions: ['3.0.0'], prereleaseVersions: [] }
      const okWithEtag = (etag?: string) =>
        requestMock.mockImplementation(async () => ({
          statusCode: 200,
          body: JSON.stringify({ versions: { '1.0.0': {} } }),
          headers: { 'content-encoding': 'identity', ...(etag ? { etag } : {}) },
        }))

      afterEach(() => {
        packumentDecoderMock.mockReset()
        packumentDecoderMock.mockReturnValue(null)
      })

      it('hands the body and the ETag cache target to the Rust decoder', async () => {
        const decode = vi.fn(async (_request: unknown) => parsed)
        packumentDecoderMock.mockReturnValue(decode)
        okWithEtag('W/"rust"')

        const result = await fetchPackageVersions(['demo-pkg'])

        expect(result.get('demo-pkg')).toEqual(parsed)
        const [request] = decode.mock.calls[0] as [
          { raw: Buffer; encoding: string; cache: { file: string; etag: string } | null },
        ]
        expect(request.raw.toString('utf8')).toBe('{"versions":{"1.0.0":{}}}')
        expect(request.encoding).toBe('identity')
        expect(request.cache?.etag).toBe('W/"rust"')
        expect(request.cache?.file.startsWith(etagTestRoot)).toBe(true)
        // Writing the entry is the decoder's job on this path.
        expect(readEtag('https://registry.npmjs.org/demo-pkg')).toBeNull()
      })

      it('asks for no cache write without an ETag or with the store disabled; encoding defaults to empty', async () => {
        const decode = vi.fn(async (_request: unknown) => parsed)
        packumentDecoderMock.mockReturnValue(decode)

        requestMock.mockImplementation(async () => ({
          statusCode: 200,
          body: JSON.stringify({ versions: { '1.0.0': {} } }),
        }))
        await fetchPackageVersions(['no-etag'])
        expect((decode.mock.calls[0][0] as { encoding: string }).encoding).toBe('')
        setEtagCacheEnabled(false)
        okWithEtag('W/"x"')
        clearPackageCache()
        await fetchPackageVersions(['store-off'])

        expect(decode.mock.calls.map(([r]) => (r as { cache: unknown }).cache)).toEqual([
          null,
          null,
        ])
      })

      it('falls back to the TypeScript decoder when the Rust decoder fails', async () => {
        const warn = vi.spyOn(debugLog, 'warn').mockImplementation(() => {})
        packumentDecoderMock.mockReturnValue(async () => {
          throw new Error('boom')
        })
        okWithEtag('W/"fallback"')

        const result = await fetchPackageVersions(['demo-pkg'])

        expect(result.get('demo-pkg')?.latestVersion).toBe('1.0.0')
        expect(readEtag('https://registry.npmjs.org/demo-pkg')?.etag).toBe('W/"fallback"')
        expect(warn).toHaveBeenCalledWith(
          'npm-registry',
          expect.stringContaining('falling back'),
          expect.any(Error)
        )
        warn.mockRestore()
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
          body: {
            ...streamOf(
              Buffer.from(JSON.stringify({ versions: { '1.0.0': {}, '1.1.0': {} } }), 'utf8')
            ),
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
          body: {
            ...streamOf(Buffer.alloc(0)),
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
          body: {
            ...streamOf(Buffer.from(JSON.stringify({ versions: { '2.0.0': {} } }), 'utf8')),
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
