import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The detector reads each manifest the moment the scan reports it, so reads finish in any order.
// These tests control when each read and the scan itself settle.
const mocks = vi.hoisted(() => ({
  findAllPackageJsonFilesAsync: vi.fn(),
  collectDependenciesAsync: vi.fn(),
  fetchPackageVersions: vi.fn(),
}))

vi.mock('../../../../src/shared/fs', () => ({
  findPackageJson: () => '/repo/package.json',
  readPackageJson: () => ({ name: 'root' }),
  findAllPackageJsonFilesAsync: mocks.findAllPackageJsonFilesAsync,
  collectDependenciesAsync: mocks.collectDependenciesAsync,
}))

// Keep catalog loading hermetic: no pnpm-workspace.yaml from the machine may leak in.
vi.mock('../../../../src/shared/pnpm-catalogs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/shared/pnpm-catalogs')>()
  return { ...actual, PnpmCatalogs: { load: () => null } }
})

vi.mock('../../../../src/shared/registry/npm-registry', async () => {
  const { collectedFetch } = await import('../../../helpers/registry-fetch')
  return { startPackageVersionFetch: collectedFetch(mocks.fetchPackageVersions) }
})

vi.mock('../../../../src/shared/config/user-config', () => ({
  configManager: { getNetworkProfile: () => null, setNetworkProfile: vi.fn() },
}))

import { PackageDetector } from '../../../../src/features/upgrade/package-detector'
import type { DeclaredDependency, PackageJsonScanOptions } from '../../../../src/shared/fs'
import type { StreamOutdatedPackagesInitialPayload } from '../../../../src/shared/types'

const ROOT = '/repo/package.json'
const APP = '/repo/packages/app/package.json'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const dep = (name: string, version: string, packageJsonPath: string): DeclaredDependency => ({
  name,
  version,
  type: 'dependencies',
  packageJsonPath,
})

/** A scan that reports `manifests` right away, then settles once `settle` does. */
const scanReporting = (manifests: string[], settle: () => Promise<void> = async () => {}) => {
  mocks.findAllPackageJsonFilesAsync.mockImplementation(
    async (...args: [string, string[], number, unknown, PackageJsonScanOptions]) => {
      for (const manifest of manifests) args[4].onPackageJson?.(manifest)
      await settle()
      return manifests
    }
  )
}

describe('PackageDetector folding manifests read out of order', () => {
  let unhandled: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mocks.fetchPackageVersions.mockImplementation(
      async (names: string[], options: { onPackageReady: (result: unknown) => void }) => {
        const data = { latestVersion: '2.0.0', allVersions: ['2.0.0', '1.0.0'] }
        for (const packageName of names) options.onPackageReady({ packageName, data })
      }
    )
    unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
  })

  afterEach(() => {
    process.off('unhandledRejection', unhandled)
    vi.clearAllMocks()
  })

  it('keeps the first declaration in scan order when a later manifest is read first', async () => {
    scanReporting([ROOT, APP])
    // The root's read is the slow one: the app's declaration lands first.
    mocks.collectDependenciesAsync.mockImplementation(async (path: string) => {
      if (path === APP) return [dep('shared', '~2.0.0', APP)]
      await sleep(20)
      return [dep('shared', '^1.0.0', ROOT)]
    })
    let initial: StreamOutdatedPackagesInitialPayload | undefined

    const packages = await new PackageDetector({ cwd: '/repo' }).streamOutdatedPackages((event) => {
      if (event.type === 'initial') initial = event.payload
    })

    expect(initial?.currentVersions.get('shared')).toBe('^1.0.0')
    expect(packages.map((pkg) => [pkg.packageJsonPath, pkg.currentVersion])).toEqual([
      [ROOT, '^1.0.0'],
      [APP, '~2.0.0'],
    ])
  })

  it('fails the run on a read that failed before its turn, never as an unhandled rejection', async () => {
    scanReporting([ROOT, APP], () => sleep(40))
    // The app's read fails while the root's is still pending.
    mocks.collectDependenciesAsync.mockImplementation(async (path: string) => {
      if (path === APP) throw new TypeError('unreadable manifest')
      await sleep(20)
      return [dep('shared', '^1.0.0', ROOT)]
    })

    await expect(
      new PackageDetector({ cwd: '/repo' }).streamOutdatedPackages(() => {})
    ).rejects.toThrow('unreadable manifest')
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('reports a failed scan, not a read that failed during it', async () => {
    scanReporting([APP], async () => {
      await sleep(20)
      throw new Error('disk went away')
    })
    mocks.collectDependenciesAsync.mockRejectedValue(new TypeError('unreadable manifest'))

    await expect(
      new PackageDetector({ cwd: '/repo' }).streamOutdatedPackages(() => {})
    ).rejects.toThrow('Failed to scan for package.json files: Error: disk went away')
    expect(unhandled).not.toHaveBeenCalled()
  })
})
