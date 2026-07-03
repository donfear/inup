import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NpmRegistryClient } from '../../../../src/features/changelog/clients/npm-registry-client'

const fetchMock = vi.fn()

const jsonResponse = (data: unknown, ok = true) => ({
  ok,
  json: async () => data,
})

const abortError = () => new DOMException('aborted', 'AbortError')

let client: NpmRegistryClient

beforeEach(() => {
  client = new NpmRegistryClient()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NpmRegistryClient.fetchPackageManifest', () => {
  it('fetches a version manifest with encoded package names', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ name: '@scope/pkg', version: '1.0.0' }))

    const manifest = await client.fetchPackageManifest('@scope/pkg', '1.0.0')

    expect(manifest).toEqual({ name: '@scope/pkg', version: '1.0.0' })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/%40scope%2Fpkg/1.0.0'),
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('returns null for missing versions and network errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, false))
    expect(await client.fetchPackageManifest('demo', '9.9.9')).toBeNull()

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await client.fetchPackageManifest('demo', '1.0.0')).toBeNull()
  })

  it('rethrows aborts', async () => {
    fetchMock.mockRejectedValue(abortError())

    await expect(client.fetchPackageManifest('demo', '1.0.0')).rejects.toThrow('aborted')
  })
})

describe('NpmRegistryClient.fetchDownloadStats', () => {
  it('fetches weekly download counts', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ downloads: 12345 }))

    const stats = await client.fetchDownloadStats('demo')

    expect(stats).toEqual({ downloads: 12345 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.npmjs.org/downloads/point/last-week/demo',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('defaults missing download counts to zero', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))

    expect(await client.fetchDownloadStats('demo')).toEqual({ downloads: 0 })
  })

  it('returns null for unknown packages and network errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, false))
    expect(await client.fetchDownloadStats('demo')).toBeNull()

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await client.fetchDownloadStats('demo')).toBeNull()
  })

  it('rethrows aborts', async () => {
    fetchMock.mockRejectedValue(abortError())

    await expect(client.fetchDownloadStats('demo')).rejects.toThrow('aborted')
  })
})
