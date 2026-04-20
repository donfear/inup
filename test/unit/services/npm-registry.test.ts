import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Pool } from 'undici'

const { getAllPackageDataFromJsdelivrMock } = vi.hoisted(() => ({
  getAllPackageDataFromJsdelivrMock: vi.fn(),
}))

vi.mock('../../../src/services/jsdelivr-registry', () => ({
  getAllPackageDataFromJsdelivr: getAllPackageDataFromJsdelivrMock,
}))

import {
  clearPackageCache,
  fetchPackageVersions,
} from '../../../src/services/npm-registry'

type MockResponse = {
  statusCode: number
  body: string
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
      return {
        statusCode: response.statusCode,
        headers: {},
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
    getAllPackageDataFromJsdelivrMock.mockReset()
  })

  afterEach(() => {
    poolRequestSpy.mockClear()
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

  it('falls back to jsdelivr when npm responds with a retryable status', async () => {
    requestMock.mockResolvedValue(makeErrBody(429))
    getAllPackageDataFromJsdelivrMock.mockResolvedValue(
      new Map([
        [
          'demo-pkg',
          {
            latestVersion: '1.1.0',
            allVersions: ['1.1.0', '1.0.0'],
          },
        ],
      ])
    )

    const currentVersions = new Map([['demo-pkg', '1.0.0']])
    const result = await fetchPackageVersions(['demo-pkg'], { currentVersions })

    expect(getAllPackageDataFromJsdelivrMock).toHaveBeenCalledWith(
      ['demo-pkg'],
      new Map([['demo-pkg', '1.0.0']])
    )
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '1.1.0',
      allVersions: ['1.1.0', '1.0.0'],
    })
  })

  it('fires onPackageStart once per package dispatch', async () => {
    requestMock.mockResolvedValue(makeOkBody({ versions: { '1.0.0': {} } }))
    const starts: string[] = []

    await fetchPackageVersions(['demo-pkg', 'demo-pkg'], {
      onPackageStart: (pkg) => starts.push(pkg),
    })

    expect(starts).toEqual(['demo-pkg', 'demo-pkg'])
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
})
