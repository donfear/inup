import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
const { getAllPackageDataFromJsdelivrMock } = vi.hoisted(() => ({
  getAllPackageDataFromJsdelivrMock: vi.fn(),
}))

vi.mock('../../../src/services/jsdelivr-registry', () => ({
  getAllPackageDataFromJsdelivr: getAllPackageDataFromJsdelivrMock,
}))

import { getAllPackageData, clearPackageCache } from '../../../src/services/npm-registry'

describe('npm-registry', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    clearPackageCache()
    fetchMock.mockReset()
    getAllPackageDataFromJsdelivrMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches version data from npm registry', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          versions: {
            '1.0.0': {},
            '1.2.0': {},
            '2.0.0-beta.1': {},
            '1.1.0': {},
          },
        }),
    })

    const result = await getAllPackageData(['demo-pkg'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '1.2.0',
      allVersions: ['1.2.0', '1.1.0', '1.0.0'],
    })
  })

  it('returns empty map for empty input', async () => {
    const result = await getAllPackageData([])

    expect(result.size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('coalesces duplicate in-flight lookups within a run', async () => {
    let resolveFetch: ((value: { ok: boolean; text: () => Promise<string> }) => void) | undefined
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        })
    )

    const pending = getAllPackageData(['demo-pkg', 'demo-pkg'])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch?.({
      ok: true,
      text: async () =>
        JSON.stringify({
          versions: {
            '1.0.0': {},
            '1.1.0': {},
          },
        }),
    })

    const result = await pending
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '1.1.0',
      allVersions: ['1.1.0', '1.0.0'],
    })
  })

  it('fetches fresh data again on a later call', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ versions: { '1.0.0': {} } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ versions: { '1.1.0': {}, '1.0.0': {} } }),
      })

    const first = await getAllPackageData(['demo-pkg'])
    const second = await getAllPackageData(['demo-pkg'])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(first.get('demo-pkg')?.latestVersion).toBe('1.0.0')
    expect(second.get('demo-pkg')?.latestVersion).toBe('1.1.0')
  })

  it('returns unknown for failed packages without aborting the batch', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('good-pkg')) {
        return Promise.resolve({
          ok: true,
          text: async () => JSON.stringify({ versions: { '1.0.0': {}, '1.1.0': {} } }),
        })
      }

      return Promise.resolve({
        ok: false,
        status: 404,
        text: async () => '',
      })
    })

    const result = await getAllPackageData(['good-pkg', 'bad-pkg'])

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
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => '',
    })
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
    const result = await getAllPackageData(['demo-pkg'], undefined, currentVersions)

    expect(getAllPackageDataFromJsdelivrMock).toHaveBeenCalledWith(
      ['demo-pkg'],
      new Map([['demo-pkg', '1.0.0']])
    )
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '1.1.0',
      allVersions: ['1.1.0', '1.0.0'],
    })
  })

  it('calls progress callback once per requested package', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ versions: { '1.0.0': {} } }),
    })
    const progressUpdates: Array<{ package: string; completed: number; total: number }> = []

    await getAllPackageData(['demo-pkg', 'demo-pkg'], (pkg, completed, total) => {
      progressUpdates.push({ package: pkg, completed, total })
    })

    expect(progressUpdates).toEqual([
      { package: 'demo-pkg', completed: 1, total: 2 },
      { package: 'demo-pkg', completed: 2, total: 2 },
    ])
  })
})
