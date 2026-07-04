import { describe, expect, it, vi } from 'vitest'
import { PackageMetadataService } from '../../../../src/features/changelog/services/package-metadata-service'
import type { NpmRegistryClient } from '../../../../src/features/changelog/clients/npm-registry-client'

function makeService(
  manifest: Record<string, unknown> | null | Error = {
    repository: { url: 'git+https://github.com/octo/demo.git' },
    homepage: 'https://demo.dev',
    description: 'demo package',
  }
) {
  const fetchPackageManifest = vi.fn(async () => {
    if (manifest instanceof Error) throw manifest
    return manifest
  })
  const client = { fetchPackageManifest } as unknown as NpmRegistryClient
  return { service: new PackageMetadataService(client), fetchPackageManifest }
}

describe('PackageMetadataService', () => {
  it('fetches, maps, and caches package metadata', async () => {
    const { service, fetchPackageManifest } = makeService()

    const metadata = await service.fetchPackageMetadata('demo', '1.0.0')
    const again = await service.fetchPackageMetadata('demo', '1.0.0')

    expect(metadata?.repositoryUrl).toContain('github.com/octo/demo')
    expect(again).toBe(metadata)
    expect(fetchPackageManifest).toHaveBeenCalledTimes(1)
    expect(service.getCached('demo', '1.0.0')).toBe(metadata)
  })

  it('deduplicates concurrent fetches for the same version', async () => {
    const { service, fetchPackageManifest } = makeService()

    await Promise.all([
      service.fetchPackageMetadata('demo', '1.0.0'),
      service.fetchPackageMetadata('demo', '1.0.0'),
    ])

    expect(fetchPackageManifest).toHaveBeenCalledTimes(1)
  })

  it('caches a null result when the manifest is missing', async () => {
    const { service, fetchPackageManifest } = makeService(null)

    expect(await service.fetchPackageMetadata('gone', '1.0.0')).toBeNull()
    expect(await service.fetchPackageMetadata('gone', '1.0.0')).toBeNull()
    expect(fetchPackageManifest).toHaveBeenCalledTimes(1)
  })

  it('caches a null result on generic fetch errors', async () => {
    const { service, fetchPackageManifest } = makeService(new Error('offline'))

    expect(await service.fetchPackageMetadata('demo', '1.0.0')).toBeNull()
    expect(await service.fetchPackageMetadata('demo', '1.0.0')).toBeNull()
    expect(fetchPackageManifest).toHaveBeenCalledTimes(1)
  })

  it('rethrows aborts without caching', async () => {
    const { service } = makeService(new DOMException('aborted', 'AbortError'))

    await expect(service.fetchPackageMetadata('demo', '1.0.0')).rejects.toThrow('aborted')
    expect(service.getCached('demo', '1.0.0')).toBeNull()
  })

  it('getCached returns null before any fetch', () => {
    const { service } = makeService()

    expect(service.getCached('demo', '1.0.0')).toBeNull()
    expect(service.getCached('demo')).toBeNull()
  })

  it('getCached surfaces a cached null result', async () => {
    const { service } = makeService(null)

    await service.fetchPackageMetadata('gone', '1.0.0')

    expect(service.getCached('gone', '1.0.0')).toBeNull()
  })

  it('leaves weekly downloads unset when stats are unavailable', async () => {
    const client = {
      fetchPackageManifest: vi.fn(async () => ({ description: 'demo package' })),
      fetchDownloadStats: vi.fn(async () => null),
    } as unknown as NpmRegistryClient
    const service = new PackageMetadataService(client)

    const metadata = await service.fetchPackageMetadata('demo', '1.0.0')

    expect(metadata?.weeklyDownloads).toBeUndefined()
  })

  it('drops an author object that has no name field', async () => {
    // The `?? rawData.author` fallback keeps the raw object, which the final
    // string check then discards — the author must come out undefined.
    const client = {
      fetchPackageManifest: vi.fn(async () => ({ author: { email: 'dev@example.com' } })),
      fetchDownloadStats: vi.fn(async () => null),
    } as unknown as NpmRegistryClient
    const service = new PackageMetadataService(client)

    const metadata = await service.fetchPackageMetadata('demo', '1.0.0')

    expect(metadata?.author).toBeUndefined()
  })

  it('caches metadata provided directly and derives the release URL', async () => {
    const { service } = makeService()

    service.cacheMetadata('demo', {
      repository: { url: 'git+https://github.com/octo/demo.git' },
    })

    const releaseUrl = service.getRepositoryReleaseUrl('demo', '1.0.0')
    expect(releaseUrl === null || releaseUrl.includes('tag/v1.0.0')).toBe(true)
  })

  it('clearCache forces a refetch', async () => {
    const { service, fetchPackageManifest } = makeService()

    await service.fetchPackageMetadata('demo', '1.0.0')
    service.clearCache()
    await service.fetchPackageMetadata('demo', '1.0.0')

    expect(fetchPackageManifest).toHaveBeenCalledTimes(2)
  })
})
