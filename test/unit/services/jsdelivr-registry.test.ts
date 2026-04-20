import { describe, it, expect } from 'vitest'
import { fetchExactPackageManifest } from '../../../src/services/jsdelivr-registry'
import { fetchPackageVersions } from '../../../src/services/npm-registry'
import { PACKAGE_NAME } from '../../../src/config/constants'

describe('jsdelivr-registry', () => {
  it('fetches an exact pinned package manifest from jsdelivr', async () => {
    const packageVersion = (await fetchPackageVersions([PACKAGE_NAME])).get(PACKAGE_NAME)?.latestVersion ?? ''

    expect(packageVersion).toMatch(/^\d+\.\d+\.\d+$/)
    const manifest = await fetchExactPackageManifest(PACKAGE_NAME, packageVersion)

    expect(manifest).not.toBeNull()
    expect(manifest?.name).toBe(PACKAGE_NAME)
    expect(manifest?.version).toBe(packageVersion)
  }, 10000)

  it('returns null for non-exact versions', async () => {
    const manifest = await fetchExactPackageManifest(PACKAGE_NAME, 'latest')

    expect(manifest).toBeNull()
  })

  it('returns null for empty versions', async () => {
    const manifest = await fetchExactPackageManifest(PACKAGE_NAME, '')

    expect(manifest).toBeNull()
  })
})
