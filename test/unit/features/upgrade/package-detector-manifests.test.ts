import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Real manifests on disk, real scan and collection — only the registry and the
// user's stored network profile are faked, so these tests cover exactly what a
// `--json`/`--check` run reads from an odd-but-valid repo.
const mocks = vi.hoisted(() => ({
  fetchPackageVersions: vi.fn(),
  startPackageVersionFetch: vi.fn(),
}))

vi.mock('../../../../src/shared/registry/npm-registry', () => ({
  startPackageVersionFetch: mocks.startPackageVersionFetch,
}))

vi.mock('../../../../src/shared/config/user-config', () => ({
  configManager: { getNetworkProfile: () => null, setNetworkProfile: vi.fn() },
}))

import { PackageDetector } from '../../../../src/features/upgrade/package-detector'
import type { PackageVersionFetchOptions } from '../../../../src/shared/registry/npm-registry'
import type { StreamOutdatedPackagesInitialPayload } from '../../../../src/shared/types'
import { collectedFetch } from '../../../helpers/registry-fetch'

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
    mocks.startPackageVersionFetch.mockImplementation(collectedFetch(mocks.fetchPackageVersions))
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

  it('resolves a lookup answered mid-scan only once every manifest has been read', async () => {
    // The root declares `shared` and the unpublished sibling `@org/utils`; another manifest
    // declares `shared` again, and the sibling's own manifest is the one that names it.
    writeManifest('.', { name: 'root', dependencies: { shared: '^1.0.0', '@org/utils': '^1.0.0' } })
    writeManifest('packages/app', { name: 'app', devDependencies: { shared: '~1.0.0' } })
    writeManifest('packages/utils', { name: '@org/utils', version: '1.0.0' })
    const answered: string[] = []
    // A registry that answers every package the moment the detector adds it, mid-scan.
    mocks.startPackageVersionFetch.mockImplementation((options: PackageVersionFetchOptions) => ({
      add: (names: Iterable<string>) => {
        for (const packageName of names) {
          answered.push(packageName)
          const data =
            packageName === 'shared'
              ? { latestVersion: '1.2.0', allVersions: ['1.2.0', '1.0.0'] }
              : { latestVersion: 'unknown', allVersions: [] }
          options.onPackageReady?.({ packageName, data })
        }
      },
      finish: async () => new Map(),
    }))
    const events: string[] = []
    let initial: StreamOutdatedPackagesInitialPayload | undefined

    const packages = await new PackageDetector({ cwd: repo }).streamOutdatedPackages((event) => {
      events.push(event.type)
      if (event.type === 'initial') initial = event.payload
    })

    expect(answered).toEqual(['@org/utils', 'shared'])
    // Nothing resolves before the scan has ended and the total is known.
    expect(events.indexOf('package')).toBeGreaterThan(events.indexOf('initial'))
    expect(initial?.progress.total).toBe(2)
    expect(initial?.currentVersions.get('shared')).toBe('^1.0.0')
    // Both declarations, though the answer came when only the root had been read.
    expect(packages.map((pkg) => [pkg.name, pkg.currentVersion])).toEqual([
      ['@org/utils', '^1.0.0'],
      ['shared', '^1.0.0'],
      ['shared', '~1.0.0'],
    ])
    // The sibling is one of the repo's own packages: unpublished is not a failed lookup.
    expect(packages[0].lookupFailed).toBeUndefined()
  })
})
