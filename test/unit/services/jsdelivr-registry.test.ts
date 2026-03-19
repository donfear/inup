import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fetchExactPackageManifest } from '../../../src/services/jsdelivr-registry'
import { PACKAGE_NAME } from '../../../src/config/constants'

describe('jsdelivr-registry', () => {
  const packageVersion = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf-8')
  ).version as string

  it('fetches an exact pinned package manifest from jsdelivr', async () => {
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
