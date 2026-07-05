import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NpmRegistryClient } from '../../../../src/features/changelog/clients/npm-registry-client'

const fetchMock = vi.fn()

const jsonResponse = (data: unknown, ok = true) => ({
  ok,
  json: async () => data,
})

const abortError = () => new DOMException('aborted', 'AbortError')

// Fixed registry targets so tests never depend on the machine's npm config.
const publicRegistry = () => ({ origin: 'https://registry.npmjs.org', pathPrefix: '' })
const privateRegistry = () => ({
  origin: 'https://registry.example.com',
  pathPrefix: '/npm',
  authHeader: 'Bearer sekret',
})

let client: NpmRegistryClient

beforeEach(() => {
  client = new NpmRegistryClient(publicRegistry)
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

  it('fetches from the npmrc-resolved registry with its authorization header', async () => {
    client = new NpmRegistryClient(privateRegistry)
    fetchMock.mockResolvedValue(jsonResponse({ name: '@scope/pkg', version: '1.0.0' }))

    await client.fetchPackageManifest('@scope/pkg', '1.0.0')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.com/npm/%40scope%2Fpkg/1.0.0',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer sekret' }),
      })
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

  it('skips the public downloads API for packages on other registries', async () => {
    client = new NpmRegistryClient(privateRegistry)

    expect(await client.fetchDownloadStats('@scope/private-pkg')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never forwards registry credentials to the downloads API', async () => {
    // A user logged into npmjs has an authHeader on the public target; the
    // downloads endpoint is a different service and must stay anonymous.
    client = new NpmRegistryClient(() => ({
      origin: 'https://registry.npmjs.org',
      pathPrefix: '',
      authHeader: 'Bearer npm-token',
    }))
    fetchMock.mockResolvedValue(jsonResponse({ downloads: 1 }))

    await client.fetchDownloadStats('demo')

    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers
    expect(headers.authorization).toBeUndefined()
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
