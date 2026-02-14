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

const { getAllPackageDataFromJsdelivr, clearJsdelivrPackageCache } = await import(
  '../../../src/services/jsdelivr-registry'
)
const { persistentCache } = await import('../../../src/services/persistent-cache')
const { JSDELIVR_RETRY_TIMEOUTS } = await import('../../../src/config/constants')

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
    requestMock
      .mockRejectedValueOnce(createTimeoutError())
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

  it('falls back to npm after jsDelivr retry budget is exhausted', async () => {
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
    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(result.get('demo-pkg')).toEqual({
      latestVersion: '9.9.9',
      allVersions: ['9.9.9'],
    })
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
})
