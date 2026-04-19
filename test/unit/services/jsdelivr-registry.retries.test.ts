import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.fn()
const closeMock = vi.fn()
const PoolMock = vi.fn(
  class MockPool {
    close = closeMock
  }
)

vi.mock('undici', () => ({
  Pool: PoolMock,
  request: requestMock,
}))

vi.mock('../../../src/config', async () => {
  const actual = await vi.importActual<typeof import('../../../src/config')>('../../../src/config')
  return {
    ...actual,
    JSDELIVR_RETRY_TIMEOUTS: [10, 20],
    JSDELIVR_RETRY_DELAYS: [1],
  }
})

const { fetchExactPackageManifest, clearExactManifestCache } = await import('../../../src/services/jsdelivr-registry')
const { JSDELIVR_RETRY_TIMEOUTS } = await import('../../../src/config')

const createTimeoutError = () => {
  const error = new Error('timeout')
  error.name = 'HeadersTimeoutError'
  return error
}

describe('jsdelivr-registry retries', () => {
  beforeEach(() => {
    vi.useRealTimers()
    requestMock.mockReset()
    closeMock.mockReset()
    PoolMock.mockClear()
    clearExactManifestCache()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      })
    )
  })

  it('retries jsDelivr exact-manifest request and succeeds', async () => {
    requestMock.mockRejectedValueOnce(createTimeoutError()).mockResolvedValueOnce({
      statusCode: 200,
      body: {
        text: async () => JSON.stringify({ name: 'demo-pkg', version: '1.2.3' }),
      },
    })

    const result = await fetchExactPackageManifest('demo-pkg', '1.2.3')

    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      name: 'demo-pkg',
      version: '1.2.3',
    })
  })

  it('returns null after retry budget is exhausted without noisy logs', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    requestMock.mockRejectedValue(createTimeoutError())

    const result = await fetchExactPackageManifest('demo-pkg', '1.2.3')

    expect(requestMock).toHaveBeenCalledTimes(JSDELIVR_RETRY_TIMEOUTS.length)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(result).toBeNull()
    consoleErrorSpy.mockRestore()
  })

  it('coalesces duplicate in-flight exact-manifest lookups for the same package/version', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        text: async () => JSON.stringify({ name: 'demo-pkg', version: '1.2.3' }),
      },
    })

    const [first, second] = await Promise.all([
      fetchExactPackageManifest('demo-pkg', '1.2.3'),
      fetchExactPackageManifest('demo-pkg', '1.2.3'),
    ])

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(first).toEqual({
      name: 'demo-pkg',
      version: '1.2.3',
    })
    expect(second).toEqual(first)
  })

  it('retries on transient HTTP status and succeeds', async () => {
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
          text: async () => JSON.stringify({ name: 'demo-pkg', version: '1.2.3' }),
        },
      })

    const result = await fetchExactPackageManifest('demo-pkg', '1.2.3')

    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      name: 'demo-pkg',
      version: '1.2.3',
    })
  })

  it('honors retry-after delay when server asks for backoff', async () => {
    vi.useFakeTimers()
    requestMock
      .mockResolvedValueOnce({
        statusCode: 429,
        headers: {
          'retry-after': '0.02',
        },
        body: {
          text: async () => 'too many requests',
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          text: async () => JSON.stringify({ name: 'demo-pkg', version: '1.2.3' }),
        },
      })

    const pending = fetchExactPackageManifest('demo-pkg', '1.2.3')
    expect(requestMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(19)
    expect(requestMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    const result = await pending

    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      name: 'demo-pkg',
      version: '1.2.3',
    })
  })

  it('treats non-positive numeric retry-after values as no server delay', async () => {
    vi.useFakeTimers()
    requestMock
      .mockResolvedValueOnce({
        statusCode: 429,
        headers: {
          'retry-after': '0',
        },
        body: {
          text: async () => 'too many requests',
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          text: async () => JSON.stringify({ name: 'demo-pkg', version: '1.2.3' }),
        },
      })

    const pending = fetchExactPackageManifest('demo-pkg', '1.2.3')
    expect(requestMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    const result = await pending

    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      name: 'demo-pkg',
      version: '1.2.3',
    })
  })

  it('reads retry-after header case-insensitively', async () => {
    vi.useFakeTimers()
    requestMock
      .mockResolvedValueOnce({
        statusCode: 429,
        headers: {
          'Retry-After': '0.02',
        },
        body: {
          text: async () => 'too many requests',
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          text: async () => JSON.stringify({ name: 'demo-pkg', version: '1.2.3' }),
        },
      })

    const pending = fetchExactPackageManifest('demo-pkg', '1.2.3')
    expect(requestMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(19)
    expect(requestMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    const result = await pending

    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      name: 'demo-pkg',
      version: '1.2.3',
    })
  })

  it('logs unexpected parse errors once and returns null', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        text: async () => '{invalid-json',
      },
    })

    const result = await fetchExactPackageManifest('demo-pkg', '1.2.3')

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
    consoleErrorSpy.mockRestore()
  })

  it('returns null on non-retryable http status', async () => {
    requestMock.mockImplementation((url: string) => {
      if (url.includes('@1.2.3')) {
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
      fetchExactPackageManifest('demo-pkg', '1.2.3'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
    ])

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('returns null when jsDelivr response is not an object', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        text: async () => JSON.stringify('not-an-object'),
      },
    })

    const result = await fetchExactPackageManifest('demo-pkg', '1.2.3')

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('returns null for non-exact versions before issuing a request', async () => {
    const result = await fetchExactPackageManifest('demo-pkg', 'latest')

    expect(requestMock).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('retries on transient network errors and succeeds', async () => {
    const dnsError = new Error('getaddrinfo ENOTFOUND cdn.jsdelivr.net') as Error & {
      code?: string
    }
    dnsError.code = 'ENOTFOUND'

    requestMock.mockRejectedValueOnce(dnsError).mockResolvedValueOnce({
      statusCode: 200,
      body: {
        text: async () => JSON.stringify({ name: 'demo-pkg', version: '1.2.3' }),
      },
    })

    const result = await fetchExactPackageManifest('demo-pkg', '1.2.3')

    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      name: 'demo-pkg',
      version: '1.2.3',
    })
  })
})
