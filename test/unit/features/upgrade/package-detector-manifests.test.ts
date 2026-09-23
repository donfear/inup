import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Real manifests on disk, real scan and collection — only the registry and the
// user's stored network profile are faked, so these tests cover exactly what a
// `--json`/`--check` run reads from an odd-but-valid repo.
const mocks = vi.hoisted(() => ({ fetchPackageVersions: vi.fn() }))

vi.mock('../../../../src/shared/registry/npm-registry', () => ({
  fetchPackageVersions: mocks.fetchPackageVersions,
}))

vi.mock('../../../../src/shared/config/user-config', () => ({
  configManager: { getNetworkProfile: () => null, setNetworkProfile: vi.fn() },
}))

import { PackageDetector } from '../../../../src/features/upgrade/package-detector'

const BOM = '\uFEFF'

describe('PackageDetector over unusual manifests', () => {
  let repo: string

  const writeManifest = (dir: string, manifest: object, prefix = '') => {
    mkdirSync(join(repo, dir), { recursive: true })
    writeFileSync(
      join(repo, dir, 'package.json'),
      `${prefix}${JSON.stringify(manifest, null, 2)}\n`
    )
  }

  const scannedNames = async () => {
    const packages = await new PackageDetector({ cwd: repo }).streamOutdatedPackages(() => {})
    return packages.map((pkg) => pkg.name).sort()
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'inup-detector-manifests-'))
    mocks.fetchPackageVersions.mockImplementation(
      async (names: string[], options: { onPackageReady: (result: unknown) => void }) => {
        const data = { latestVersion: '2.0.0', allVersions: ['2.0.0', '1.0.0'] }
        for (const packageName of names) options.onPackageReady({ packageName, data })
        return new Map(names.map((name) => [name, data]))
      }
    )
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('scans root and nested manifests saved with a UTF-8 byte order mark', async () => {
    writeManifest('.', { name: 'root', dependencies: { alpha: '^1.0.0' } }, BOM)
    writeManifest('packages/a', { name: 'a', dependencies: { beta: '^1.0.0' } }, BOM)

    expect(await scannedNames()).toEqual(['alpha', 'beta'])
  })

  it('skips a dependency whose value is not a string and completes the run', async () => {
    writeManifest('.', { name: 'root', dependencies: { alpha: '^1.0.0' } })
    writeManifest('packages/a', { name: 'a', dependencies: { foo: null, beta: '^1.0.0' } })

    expect(await scannedNames()).toEqual(['alpha', 'beta'])
  })
})
