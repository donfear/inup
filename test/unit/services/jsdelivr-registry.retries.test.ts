import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.fn()
const closeMock = vi.fn()
const getAllPackageDataMock = vi.fn()

vi.mock('undici', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    close: closeMock,
  })),
  request: requestMock,
}))

vi.mock('../../../src/services/npm-registry', () => ({
  getAllPackageData: getAllPackageDataMock,
}))

vi.mock('../../../src/config', async () => {
  const actual = await vi.importActual<typeof import('../../../src/config')>('../../../src/config')
  return {
    ...actual,
    JSDELIVR_RETRY_TIMEOUTS: [10, 20],
    JSDELIVR_RETRY_DELAYS: [1],
  }
})

const { getAllPackageDataFromJsdelivr, clearJsdelivrPackageCache } =
  await import('../../../src/services/jsdelivr-registry')
const { persistentCache } = await import('../../../src/services/persistent-cache')
const { JSDELIVR_RETRY_TIMEOUTS } = await import('../../../src/config')

const createTimeoutError = () => {
  const error = new Error('timeout')
  error.name = 'HeadersTimeoutError'
  return error
}

describe('jsdelivr-registry retries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearJsdelivrPackageCache()
    persistentCache.clearCache()
  })

  it('retries jsDelivr request and succeeds before fallback', async () => {
    requestMock.mockRejectedValueOnce(createTimeoutError()).mockResolvedValueOnce({
      statusCode: 200,
      body: {
        text: async () => JSON.stringify({ version: '1.2.3' }),
      },
    })

    const result = await getAllPackageDataFromJsdelivr(['demo-pkg'])

    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(getAllPackageDataMock).not.toHaveBeenCalled()
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '1.2.3',
      allVersions: ['1.2.3'],
    })
  })

  it('falls back to npm after jsDelivr retry budget is exhausted without noisy logs', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    requestMock.mockRejectedValue(createTimeoutError())
    getAllPackageDataMock.mockResolvedValue(
      new Map([
        [
          'demo-pkg',
          {
            latestVersion: '9.9.9',
            allVersions: ['9.9.9'],
          },
        ],
      ])
    )

    const result = await getAllPackageDataFromJsdelivr(['demo-pkg'])

    expect(requestMock).toHaveBeenCalledTimes(JSDELIVR_RETRY_TIMEOUTS.length)
    expect(getAllPackageDataMock).toHaveBeenCalledWith(['demo-pkg'])
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '9.9.9',
      allVersions: ['9.9.9'],
    })
    consoleErrorSpy.mockRestore()
  })

  it('reports progress exactly once per package when retries are exhausted', async () => {
    requestMock.mockRejectedValue(createTimeoutError())
    getAllPackageDataMock.mockResolvedValue(
      new Map([
        [
          'demo-pkg',
          {
            latestVersion: '9.9.9',
            allVersions: ['9.9.9'],
          },
        ],
      ])
    )
    const progressUpdates: Array<{ pkg: string; completed: number; total: number }> = []

    await getAllPackageDataFromJsdelivr(['demo-pkg'], undefined, (pkg, completed, total) => {
      progressUpdates.push({ pkg, completed, total })
    })

    expect(progressUpdates).toEqual([{ pkg: 'demo-pkg', completed: 1, total: 1 }])
  })

  it('coalesces duplicate in-flight jsDelivr lookups for the same package', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        text: async () => JSON.stringify({ version: '1.2.3' }),
      },
    })
    const progressUpdates: Array<{ pkg: string; completed: number; total: number }> = []

    const result = await getAllPackageDataFromJsdelivr(
      ['demo-pkg', 'demo-pkg'],
      undefined,
      (pkg, completed, total) => {
        progressUpdates.push({ pkg, completed, total })
      }
    )

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(getAllPackageDataMock).not.toHaveBeenCalled()
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '1.2.3',
      allVersions: ['1.2.3'],
    })
    expect(progressUpdates).toEqual([
      { pkg: 'demo-pkg', completed: 1, total: 2 },
      { pkg: 'demo-pkg', completed: 2, total: 2 },
    ])
  })

  it('coalesces duplicate npm fallbacks when jsDelivr retries are exhausted', async () => {
    requestMock.mockRejectedValue(createTimeoutError())
    getAllPackageDataMock.mockResolvedValue(
      new Map([
        [
          'demo-pkg',
          {
            latestVersion: '9.9.9',
            allVersions: ['9.9.9'],
          },
        ],
      ])
    )
    const progressUpdates: Array<{ pkg: string; completed: number; total: number }> = []

    const result = await getAllPackageDataFromJsdelivr(
      ['demo-pkg', 'demo-pkg'],
      undefined,
      (pkg, completed, total) => {
        progressUpdates.push({ pkg, completed, total })
      }
    )

    expect(requestMock).toHaveBeenCalledTimes(JSDELIVR_RETRY_TIMEOUTS.length)
    expect(getAllPackageDataMock).toHaveBeenCalledTimes(1)
    expect(getAllPackageDataMock).toHaveBeenCalledWith(['demo-pkg'])
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '9.9.9',
      allVersions: ['9.9.9'],
    })
    expect(progressUpdates).toEqual([
      { pkg: 'demo-pkg', completed: 1, total: 2 },
      { pkg: 'demo-pkg', completed: 2, total: 2 },
    ])
  })

  it('retries on transient HTTP status and succeeds without npm fallback', async () => {
    requestMock
      .mockResolvedValueOnce({
        statusCode: 503,
        body: {
          text: async () => 'service unavailable',
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          text: async () => JSON.stringify({ version: '1.2.3' }),
        },
      })

    const result = await getAllPackageDataFromJsdelivr(['demo-pkg'])

    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(getAllPackageDataMock).not.toHaveBeenCalled()
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '1.2.3',
      allVersions: ['1.2.3'],
    })
  })

  it('logs unexpected parse errors once and then falls back to npm', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        text: async () => '{invalid-json',
      },
    })
    getAllPackageDataMock.mockResolvedValue(
      new Map([
        [
          'demo-pkg',
          {
            latestVersion: '9.9.9',
            allVersions: ['9.9.9'],
          },
        ],
      ])
    )

    const result = await getAllPackageDataFromJsdelivr(['demo-pkg'])

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(getAllPackageDataMock).toHaveBeenCalledWith(['demo-pkg'])
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '9.9.9',
      allVersions: ['9.9.9'],
    })
    consoleErrorSpy.mockRestore()
  })

  it('falls back immediately when latest fails and skips major fetch', async () => {
    getAllPackageDataMock.mockResolvedValue(
      new Map([
        [
          'demo-pkg',
          {
            latestVersion: '9.9.9',
            allVersions: ['9.9.9'],
          },
        ],
      ])
    )

    requestMock.mockImplementation((url: string) => {
      if (url.includes('@latest')) {
        return Promise.resolve({
          statusCode: 404,
          body: {
            text: async () => 'not found',
          },
        })
      }

      throw new Error(`unexpected url ${url}`)
    })

    const result = await Promise.race([
      getAllPackageDataFromJsdelivr(['demo-pkg'], new Map([['demo-pkg', '1.0.0']])),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout waiting for fallback')), 250)
      ),
    ])

    expect(getAllPackageDataMock).toHaveBeenCalledWith(['demo-pkg'])
    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '9.9.9',
      allVersions: ['9.9.9'],
    })
  })

  it('skips major request when current major matches latest major', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        text: async () => JSON.stringify({ version: '1.2.3' }),
      },
    })

    const result = await getAllPackageDataFromJsdelivr(
      ['demo-pkg'],
      new Map([['demo-pkg', '1.0.0']])
    )

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(getAllPackageDataMock).not.toHaveBeenCalled()
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '1.2.3',
      allVersions: ['1.2.3'],
    })
  })

  it('falls back when jsDelivr response contains a non-string version', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        text: async () => JSON.stringify({ version: 123 }),
      },
    })
    getAllPackageDataMock.mockResolvedValue(
      new Map([
        [
          'demo-pkg',
          {
            latestVersion: '9.9.9',
            allVersions: ['9.9.9'],
          },
        ],
      ])
    )

    const result = await getAllPackageDataFromJsdelivr(['demo-pkg'])

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(getAllPackageDataMock).toHaveBeenCalledWith(['demo-pkg'])
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '9.9.9',
      allVersions: ['9.9.9'],
    })
  })

  it('skips major request when current version is not a valid semver', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        text: async () => JSON.stringify({ version: '1.2.3' }),
      },
    })

    const result = await getAllPackageDataFromJsdelivr(
      ['demo-pkg'],
      new Map([['demo-pkg', 'not-a-version']])
    )

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(getAllPackageDataMock).not.toHaveBeenCalled()
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '1.2.3',
      allVersions: ['1.2.3'],
    })
  })

  it('keeps latest version first when it is not semver and major version is semver', async () => {
    requestMock.mockImplementation((url: string) => {
      if (url.includes('@latest')) {
        return Promise.resolve({
          statusCode: 200,
          body: {
            text: async () => JSON.stringify({ version: 'stable' }),
          },
        })
      }

      return Promise.resolve({
        statusCode: 200,
        body: {
          text: async () => JSON.stringify({ version: '1.0.0' }),
        },
      })
    })

    const result = await getAllPackageDataFromJsdelivr(
      ['demo-pkg'],
      new Map([['demo-pkg', '1.2.0']])
    )

    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(getAllPackageDataMock).not.toHaveBeenCalled()
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: 'stable',
      allVersions: ['stable', '1.0.0'],
    })
  })

  it('retries on transient network errors and succeeds', async () => {
    const dnsError = new Error('getaddrinfo ENOTFOUND cdn.jsdelivr.net') as Error & {
      code?: string
    }
    dnsError.code = 'ENOTFOUND'

    requestMock.mockRejectedValueOnce(dnsError).mockResolvedValueOnce({
      statusCode: 200,
      body: {
        text: async () => JSON.stringify({ version: '1.2.3' }),
      },
    })

    const result = await getAllPackageDataFromJsdelivr(['demo-pkg'])

    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(getAllPackageDataMock).not.toHaveBeenCalled()
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '1.2.3',
      allVersions: ['1.2.3'],
    })
  })
})
