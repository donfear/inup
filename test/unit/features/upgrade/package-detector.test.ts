import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findPackageJson: vi.fn(),
  readPackageJson: vi.fn(),
  findAllPackageJsonFilesAsync: vi.fn(),
  collectAllDependenciesAsync: vi.fn(),
  findClosestMinorVersion: vi.fn(),
  fetchPackageVersions: vi.fn(),
  loadPnpmCatalogs: vi.fn(),
  isPerfLoggingEnabled: vi.fn(() => false),
  getNetworkProfile: vi.fn(() => null),
  setNetworkProfile: vi.fn(),
  performanceTracker: {
    mark: vi.fn(),
    recordControlTick: vi.fn(),
    recordPackageTiming: vi.fn(),
    recordFailedPackage: vi.fn(),
    recordCounts: vi.fn(),
    recordPhaseDuration: vi.fn(),
  },
}))

vi.mock('../../../../src/shared/fs', () => ({
  findPackageJson: mocks.findPackageJson,
  readPackageJson: mocks.readPackageJson,
  findAllPackageJsonFilesAsync: mocks.findAllPackageJsonFilesAsync,
  collectAllDependenciesAsync: mocks.collectAllDependenciesAsync,
}))

vi.mock('../../../../src/shared/versions', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    findClosestMinorVersion: mocks.findClosestMinorVersion,
  }
})

// Keep catalog loading hermetic: neither the machine's nor this repo's own
// pnpm-workspace.yaml may leak into these tests.
vi.mock('../../../../src/shared/pnpm-catalogs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/shared/pnpm-catalogs')>()
  return {
    ...actual,
    PnpmCatalogs: { load: mocks.loadPnpmCatalogs },
  }
})

vi.mock('../../../../src/shared/debug-logger', () => ({
  debugLog: {
    info: vi.fn(),
    perf: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../../../src/shared/registry/npm-registry', () => ({
  fetchPackageVersions: mocks.fetchPackageVersions,
}))

vi.mock('../../../../src/features/debug', () => ({
  getPerformanceTracker: () => mocks.performanceTracker,
  isPerfLoggingEnabled: mocks.isPerfLoggingEnabled,
}))

vi.mock('../../../../src/shared/config', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    isPackageIgnored: vi.fn(() => false),
  }
})

vi.mock('../../../../src/shared/terminal', () => ({
  ConsoleUtils: {
    showProgress: vi.fn(),
    clearProgress: vi.fn(),
  },
}))

// Keep the detector's profile read/write away from the user's real config.
vi.mock('../../../../src/shared/config/user-config', () => ({
  configManager: {
    getNetworkProfile: mocks.getNetworkProfile,
    setNetworkProfile: mocks.setNetworkProfile,
  },
}))

import { PackageDetector } from '../../../../src/features/upgrade/package-detector'
import { debugLog } from '../../../../src/shared/debug-logger'
import { ConsoleUtils } from '../../../../src/shared/terminal'

describe('PackageDetector streaming', () => {
  beforeEach(() => {
    mocks.loadPnpmCatalogs.mockReturnValue(null)
    mocks.findPackageJson.mockReturnValue('/repo/package.json')
    mocks.readPackageJson.mockReturnValue({ name: 'fixture' })
    mocks.findAllPackageJsonFilesAsync.mockResolvedValue(['/repo/package.json'])
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      {
        name: 'zod',
        version: '^3.0.0',
        type: 'dependencies',
        packageJsonPath: '/repo/package.json',
      },
      {
        name: '@scope/pkg',
        version: '^1.0.0',
        type: 'devDependencies',
        packageJsonPath: '/repo/package.json',
      },
    ])
    mocks.findClosestMinorVersion.mockImplementation(
      (version: string, versions: string[]) => versions[0] ?? version
    )
    mocks.fetchPackageVersions.mockImplementation(
      async (
        packageNames: string[],
        options: {
          onPackageReady: (result: any) => void
          maxConcurrency: number
        }
      ) => {
        expect(packageNames).toEqual(['@scope/pkg', 'zod'])
        expect(options.maxConcurrency).toBe(10)
        const onPackageReady = options.onPackageReady

        onPackageReady({
          packageName: '@scope/pkg',
          data: { latestVersion: '2.0.0', allVersions: ['1.2.0', '1.0.0'] },
        })

        onPackageReady({
          packageName: 'zod',
          data: { latestVersion: 'unknown', allVersions: [] },
        })

        return new Map([
          ['@scope/pkg', { latestVersion: '2.0.0', allVersions: ['1.2.0', '1.0.0'] }],
          ['zod', { latestVersion: 'unknown', allVersions: [] }],
        ])
      }
    )
  })

  it('emits initial, one package event per package, and complete in stable order', async () => {
    const detector = new PackageDetector({ cwd: '/repo' })
    const eventTypes: string[] = []
    const packageNames: string[] = []

    const packages = await detector.streamOutdatedPackages((event) => {
      eventTypes.push(event.type)

      if (event.type === 'initial') {
        expect(event.payload.uniquePackages).toEqual(['@scope/pkg', 'zod'])
        expect(event.payload.progress).toMatchObject({
          total: 2,
          resolved: 0,
          isLoading: true,
        })
      }

      if (event.type === 'package') {
        packageNames.push(event.payload.packageName)
        expect(event.payload.progress.phase).toBe('resolving')
        expect(event.payload.progress.isLoading).toBe(true)
      }

      if (event.type === 'complete') {
        expect(event.payload.progress).toMatchObject({
          phase: 'done',
          total: 2,
          resolved: 2,
          failed: 1,
          isLoading: false,
        })
      }
    })

    expect(eventTypes).toEqual([
      'status',
      'status',
      'status',
      'initial',
      'package',
      'package',
      'complete',
    ])
    expect(packageNames).toEqual(['@scope/pkg', 'zod'])
    expect(packages.map((pkg) => pkg.name)).toEqual(['@scope/pkg', 'zod'])
    expect(packages[0]).toMatchObject({
      name: '@scope/pkg',
      isOutdated: true,
      hasRangeUpdate: true,
      hasMajorUpdate: true,
    })
    expect(packages[1]).toMatchObject({
      name: 'zod',
      latestVersion: 'unknown',
      isOutdated: false,
    })
  })

  it('advances progress by one per package and flags failures without breaking order', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      { name: 'a', version: '^1.0.0', type: 'dependencies', packageJsonPath: '/repo/package.json' },
      { name: 'b', version: '^1.0.0', type: 'dependencies', packageJsonPath: '/repo/package.json' },
      { name: 'c', version: '^1.0.0', type: 'dependencies', packageJsonPath: '/repo/package.json' },
    ])
    const ok = { latestVersion: '2.0.0', allVersions: ['1.2.0', '1.0.0'] }
    const failed = { latestVersion: 'unknown', allVersions: [] }
    mocks.fetchPackageVersions.mockImplementation(async (_names: string[], options: any) => {
      options.onPackageReady({ packageName: 'a', data: ok })
      options.onPackageReady({ packageName: 'b', data: failed })
      options.onPackageReady({ packageName: 'c', data: ok })
      return new Map([
        ['a', ok],
        ['b', failed],
        ['c', ok],
      ])
    })
    mocks.performanceTracker.recordCounts.mockClear()
    mocks.performanceTracker.recordFailedPackage.mockClear()

    const seen: Array<[string, string, number, number, boolean]> = []
    const detector = new PackageDetector({ cwd: '/repo' })
    await detector.streamOutdatedPackages((event) => {
      if (event.type !== 'package') return
      const { packageName, packageInfo, progress } = event.payload
      seen.push([
        packageName,
        packageInfo[0].latestVersion,
        progress.resolved,
        progress.failed,
        progress.isLoading,
      ])
    })

    expect(seen).toEqual([
      ['a', '2.0.0', 1, 0, true],
      ['b', 'unknown', 2, 1, true],
      ['c', '2.0.0', 3, 1, true],
    ])
    expect(mocks.performanceTracker.recordFailedPackage).toHaveBeenCalledTimes(1)
    expect(mocks.performanceTracker.recordFailedPackage).toHaveBeenCalledWith('b')
    expect(mocks.performanceTracker.recordCounts).toHaveBeenLastCalledWith({
      resolved: 3,
      failed: 1,
    })
  })

  it('resolves each specifier once per scan while preserving workspace and catalog sources', async () => {
    mocks.loadPnpmCatalogs.mockReturnValue({
      path: '/repo/pnpm-workspace.yaml',
      resolve: () => ({ catalog: 'default', range: '^1.0.0' }),
      entriesOf: () => [{ name: 'shared', range: '^1.0.0' }],
    })
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      {
        name: 'shared',
        version: '^1.0.0',
        type: 'dependencies',
        packageJsonPath: '/repo/a/package.json',
      },
      {
        name: 'shared',
        version: '^1.0.0',
        type: 'devDependencies',
        packageJsonPath: '/repo/b/package.json',
      },
      {
        name: 'shared',
        version: 'catalog:',
        type: 'optionalDependencies',
        packageJsonPath: '/repo/c/package.json',
      },
      {
        name: 'shared',
        version: '^2.0.0',
        type: 'peerDependencies',
        packageJsonPath: '/repo/d/package.json',
      },
    ])
    let range = '1.5.0'
    mocks.fetchPackageVersions.mockImplementation(async (_names: string[], options: any) => {
      const data = { latestVersion: '3.0.0', allVersions: [range, '1.0.0'] }
      options.onPackageReady({ packageName: 'shared', data })
      return new Map([['shared', data]])
    })
    mocks.findClosestMinorVersion.mockClear()
    const detector = new PackageDetector({ cwd: '/repo' })
    const first = await detector.getOutdatedPackages()
    expect(mocks.findClosestMinorVersion).toHaveBeenCalledTimes(2)
    expect(first.map((pkg) => [pkg.packageJsonPath, pkg.type, pkg.catalog])).toEqual([
      ['/repo/a/package.json', 'dependencies', undefined],
      ['/repo/b/package.json', 'devDependencies', undefined],
      ['/repo/pnpm-workspace.yaml', 'optionalDependencies', 'default'],
      ['/repo/d/package.json', 'peerDependencies', undefined],
    ])
    expect(first[2].catalogReferencedBy).toEqual(['/repo/c/package.json'])
    expect(first[2].catalogEntries).toEqual([{ name: 'shared', range: '^1.0.0' }])
    expect(first[0]).not.toBe(first[1])
    expect(first[0].catalogEntries).toBeUndefined()
    range = '1.6.0'
    const second = await detector.getOutdatedPackages()
    expect(mocks.findClosestMinorVersion).toHaveBeenCalledTimes(4)
    expect(second[0].rangeVersion).toBe('1.6.0')
    expect(first[0].rangeVersion).toBe('1.5.0')
  })

  it('ignores unexpected registry results with no corresponding dependency', async () => {
    mocks.fetchPackageVersions.mockImplementation(async (_names: string[], options: any) => {
      options.onPackageReady({
        packageName: 'unrequested',
        data: { latestVersion: '1.0.0', allVersions: ['1.0.0'] },
      })
      return new Map()
    })
    expect(await new PackageDetector({ cwd: '/repo' }).getOutdatedPackages()).toEqual([])
  })

  it('keeps getOutdatedPackages compatible with the streamed implementation', async () => {
    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages).toHaveLength(2)
    expect(packages[0].name).toBe('@scope/pkg')
    expect(packages[1].name).toBe('zod')
  })

  it('resolves catalog refs into single entries sourced from pnpm-workspace.yaml', async () => {
    mocks.loadPnpmCatalogs.mockReturnValue({
      path: '/repo/pnpm-workspace.yaml',
      resolve: (name: string, spec: string) => {
        if (name === 'react' && spec === 'catalog:') return { catalog: 'default', range: '^18.2.0' }
        if (name === 'react' && spec === 'catalog:react19')
          return { catalog: 'react19', range: '^19.0.0' }
        return null
      },
      entriesOf: (catalog: string) =>
        catalog === 'default'
          ? [
              { name: 'react', range: '^18.2.0' },
              { name: 'lodash', range: '^4.17.0' },
            ]
          : [{ name: 'react', range: '^19.0.0' }],
    })
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      // Two packages referencing the same default-catalog entry → ONE dependency.
      {
        name: 'react',
        version: 'catalog:',
        type: 'dependencies',
        packageJsonPath: '/repo/packages/a/package.json',
      },
      {
        name: 'react',
        version: 'catalog:',
        type: 'dependencies',
        packageJsonPath: '/repo/packages/b/package.json',
      },
      // A named catalog is a distinct entry.
      {
        name: 'react',
        version: 'catalog:react19',
        type: 'dependencies',
        packageJsonPath: '/repo/packages/c/package.json',
      },
      // Unresolvable refs are dropped, never sent to the registry.
      {
        name: 'ghost',
        version: 'catalog:missing',
        type: 'dependencies',
        packageJsonPath: '/repo/packages/a/package.json',
      },
    ])
    mocks.fetchPackageVersions.mockImplementation(
      async (packageNames: string[], options: { onPackageReady: (result: any) => void }) => {
        expect(packageNames).toEqual(['react'])
        const data = { latestVersion: '19.1.0', allVersions: ['19.1.0', '18.3.0', '18.2.0'] }
        options.onPackageReady({ packageName: 'react', data })
        return new Map([['react', data]])
      }
    )

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages).toHaveLength(2)
    expect(packages[0]).toMatchObject({
      name: 'react',
      currentVersion: '^18.2.0',
      catalog: 'default',
      packageJsonPath: '/repo/pnpm-workspace.yaml',
    })
    expect(packages[1]).toMatchObject({
      name: 'react',
      currentVersion: '^19.0.0',
      catalog: 'react19',
      packageJsonPath: '/repo/pnpm-workspace.yaml',
    })
    expect(packages.some((pkg) => pkg.name === 'ghost')).toBe(false)

    // The catalog's full contents and every referencing package are carried
    // along for the info modal.
    expect(packages[0].catalogEntries).toEqual([
      { name: 'react', range: '^18.2.0' },
      { name: 'lodash', range: '^4.17.0' },
    ])
    expect(packages[0].catalogReferencedBy).toEqual([
      '/repo/packages/a/package.json',
      '/repo/packages/b/package.json',
    ])
    expect(packages[1].catalogReferencedBy).toEqual(['/repo/packages/c/package.json'])
  })

  it('skips catalog entries whose resolved range is a workspace reference', async () => {
    mocks.loadPnpmCatalogs.mockReturnValue({
      path: '/repo/pnpm-workspace.yaml',
      resolve: () => ({ catalog: 'default', range: 'workspace:*' }),
      entriesOf: () => [],
    })
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      {
        name: 'internal-lib',
        version: 'catalog:',
        type: 'dependencies',
        packageJsonPath: '/repo/packages/a/package.json',
      },
    ])
    mocks.fetchPackageVersions.mockImplementation(async (packageNames: string[]) => {
      expect(packageNames).toEqual([])
      return new Map()
    })

    const detector = new PackageDetector({ cwd: '/repo' })

    expect(await detector.getOutdatedPackages()).toEqual([])
  })

  it('keeps one entry per catalog even when referenced under different dep types', async () => {
    mocks.loadPnpmCatalogs.mockReturnValue({
      path: '/repo/pnpm-workspace.yaml',
      resolve: (_name: string, spec: string) =>
        spec === 'catalog:' ? { catalog: 'default', range: '^1.0.0' } : null,
      entriesOf: () => [{ name: 'shared-lib', range: '^1.0.0' }],
    })
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      {
        name: 'shared-lib',
        version: 'catalog:',
        type: 'dependencies',
        packageJsonPath: '/repo/packages/a/package.json',
      },
      {
        name: 'shared-lib',
        version: 'catalog:',
        type: 'devDependencies',
        packageJsonPath: '/repo/packages/b/package.json',
      },
    ])
    mocks.fetchPackageVersions.mockImplementation(
      async (packageNames: string[], options: { onPackageReady: (result: any) => void }) => {
        expect(packageNames).toEqual(['shared-lib'])
        const data = { latestVersion: '1.2.0', allVersions: ['1.2.0', '1.0.0'] }
        options.onPackageReady({ packageName: 'shared-lib', data })
        return new Map([['shared-lib', data]])
      }
    )

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    // The catalog entry is written once to pnpm-workspace.yaml no matter how
    // many packages reference it; the first referencing type wins for display.
    expect(packages).toHaveLength(1)
    expect(packages[0]).toMatchObject({
      name: 'shared-lib',
      type: 'dependencies',
      catalog: 'default',
      packageJsonPath: '/repo/pnpm-workspace.yaml',
    })
    // Both referencing packages are remembered for the Used-by tab.
    expect(packages[0].catalogReferencedBy).toEqual([
      '/repo/packages/a/package.json',
      '/repo/packages/b/package.json',
    ])
  })

  it('applies the ignore list to catalog entries', async () => {
    const { isPackageIgnored } = await import('../../../../src/shared/config')
    vi.mocked(isPackageIgnored).mockImplementation((name: string) => name === 'react')
    try {
      mocks.loadPnpmCatalogs.mockReturnValue({
        path: '/repo/pnpm-workspace.yaml',
        resolve: () => ({ catalog: 'default', range: '^18.0.0' }),
        entriesOf: () => [],
      })
      mocks.collectAllDependenciesAsync.mockResolvedValue([
        {
          name: 'react',
          version: 'catalog:',
          type: 'dependencies',
          packageJsonPath: '/repo/packages/a/package.json',
        },
      ])
      mocks.fetchPackageVersions.mockImplementation(async (packageNames: string[]) => {
        expect(packageNames).toEqual([])
        return new Map()
      })

      const detector = new PackageDetector({ cwd: '/repo', ignorePackages: ['react'] })

      expect(await detector.getOutdatedPackages()).toEqual([])
    } finally {
      vi.mocked(isPackageIgnored).mockImplementation(() => false)
    }
  })
})

describe('PackageDetector edge paths', () => {
  const dep = (name: string, version: string, packageJsonPath = '/repo/package.json') => ({
    name,
    version,
    type: 'dependencies',
    packageJsonPath,
  })

  beforeEach(() => {
    mocks.isPerfLoggingEnabled.mockReturnValue(false)
    Object.values(mocks.performanceTracker).forEach((fn) => {
      fn.mockClear()
    })
    vi.mocked(debugLog.info).mockClear()
    vi.mocked(debugLog.warn).mockClear()
    vi.mocked(debugLog.error).mockClear()
    vi.mocked(ConsoleUtils.showProgress).mockClear()
    mocks.loadPnpmCatalogs.mockReturnValue(null)
    mocks.findPackageJson.mockClear()
    mocks.findPackageJson.mockReturnValue('/repo/package.json')
    mocks.readPackageJson.mockClear()
    mocks.readPackageJson.mockReturnValue({ name: 'fixture' })
    mocks.findAllPackageJsonFilesAsync.mockReset()
    mocks.findAllPackageJsonFilesAsync.mockResolvedValue(['/repo/package.json'])
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('zod', '^1.0.0')])
    mocks.findClosestMinorVersion.mockReset()
    mocks.findClosestMinorVersion.mockImplementation(
      (version: string, versions: string[]) => versions[0] ?? version
    )
    mocks.fetchPackageVersions.mockReset()
    mocks.fetchPackageVersions.mockImplementation(
      async (packageNames: string[], options: { onPackageReady: (result: any) => void }) => {
        const data = { latestVersion: '2.0.0', allVersions: ['2.0.0', '1.2.0', '1.0.0'] }
        for (const packageName of packageNames) options.onPackageReady({ packageName, data })
        return new Map(packageNames.map((name) => [name, data]))
      }
    )
  })

  it('defaults cwd to process.cwd() and exposes the perf config', () => {
    const detector = new PackageDetector()

    expect(mocks.findPackageJson).toHaveBeenCalledWith(process.cwd())
    expect(detector.hasPackageJson()).toBe(true)
    expect(detector.getPerfConfig()).toEqual({
      cwd: process.cwd(),
      adaptive: true,
      maxConcurrency: 10,
      poolConnections: expect.any(Number),
      controllerMode: 'hillclimb',
      pinnedConcurrency: null,
      hadNetworkProfile: false,
      profileLearnedLimit: null,
    })
  })

  it('reports no package.json and refuses to stream without one', async () => {
    mocks.findPackageJson.mockReturnValue(null)

    const detector = new PackageDetector({ cwd: '/nowhere' })

    expect(detector.hasPackageJson()).toBe(false)
    expect(mocks.readPackageJson).not.toHaveBeenCalled()
    await expect(detector.streamOutdatedPackages(() => {})).rejects.toThrow(
      'No package.json found in current directory'
    )
  })

  it('forwards control ticks and per-package latency to the tracker in every run', async () => {
    // Not gated on INUP_PERF: the in-app performance modal reads these timings.
    mocks.isPerfLoggingEnabled.mockReturnValue(false)
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      dep('zod', '^1.0.0'),
      dep('never-resolved', '^1.0.0'),
    ])
    mocks.fetchPackageVersions.mockImplementation(
      async (
        _packageNames: string[],
        options: {
          onPackageReady: (result: any) => void
          onControlTick: (tick: unknown) => void
          onPackageTiming?: (name: string, latencyMs: number) => void
        }
      ) => {
        options.onControlTick({ inFlight: 1 })
        expect(options.onPackageTiming).toBeDefined()
        options.onPackageTiming!('zod', 12)
        const data = { latestVersion: '2.0.0', allVersions: ['2.0.0', '1.0.0'] }
        // Only one of the two packages ever resolves: the other must fall
        // back to an empty group in the final assembly.
        options.onPackageReady({ packageName: 'zod', data })
        return new Map([['zod', data]])
      }
    )

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages.map((pkg) => pkg.name)).toEqual(['zod'])
    expect(mocks.performanceTracker.recordControlTick).toHaveBeenCalledWith({ inFlight: 1 })
    expect(mocks.performanceTracker.recordPackageTiming).toHaveBeenCalledWith({
      name: 'zod',
      latencyMs: 12,
    })
  })

  it('emits the found-files count as collection status', async () => {
    mocks.findAllPackageJsonFilesAsync.mockResolvedValue([
      '/repo/package.json',
      '/repo/packages/a/package.json',
    ])

    const detector = new PackageDetector({ cwd: '/repo' })
    const statuses: unknown[] = []
    await detector.streamOutdatedPackages((event) => {
      if (event.type === 'status') statuses.push(event.payload.progress)
    })

    expect(statuses).toContainEqual(
      expect.objectContaining({ phase: 'collecting', packageJsonFiles: 2 })
    )
  })

  it('dedupes repeated workspace refs, ignored packages, and same-manifest catalog refs', async () => {
    const { isPackageIgnored } = await import('../../../../src/shared/config')
    vi.mocked(isPackageIgnored).mockImplementation((name: string) => name === 'left-pad')
    try {
      mocks.loadPnpmCatalogs.mockReturnValue({
        path: '/repo/pnpm-workspace.yaml',
        resolve: () => ({ catalog: 'default', range: '^1.0.0' }),
        entriesOf: () => [{ name: 'shared-lib', range: '^1.0.0' }],
      })
      mocks.collectAllDependenciesAsync.mockResolvedValue([
        dep('internal', 'workspace:*', '/repo/packages/a/package.json'),
        dep('internal', 'workspace:*', '/repo/packages/b/package.json'),
        dep('left-pad', '^1.0.0', '/repo/packages/a/package.json'),
        dep('left-pad', '^1.0.0', '/repo/packages/b/package.json'),
        // Same catalog entry referenced twice from the SAME manifest
        // (dependencies + devDependencies): remembered once in Used-by.
        dep('shared-lib', 'catalog:', '/repo/packages/a/package.json'),
        {
          name: 'shared-lib',
          version: 'catalog:',
          type: 'devDependencies',
          packageJsonPath: '/repo/packages/a/package.json',
        },
      ])

      const detector = new PackageDetector({ cwd: '/repo', ignorePackages: ['left-pad'] })
      const packages = await detector.getOutdatedPackages()

      expect(packages.map((pkg) => pkg.name)).toEqual(['shared-lib'])
      expect(packages[0].catalogReferencedBy).toEqual(['/repo/packages/a/package.json'])
      const wsLogs = vi
        .mocked(debugLog.info)
        .mock.calls.filter((call) => String(call[1]).includes('skipping non-registry specifier'))
      expect(wsLogs).toHaveLength(1)
      const ignoreLogs = vi
        .mocked(debugLog.info)
        .mock.calls.filter((call) => String(call[1]).includes('ignoring package'))
      expect(ignoreLogs).toHaveLength(1)
    } finally {
      vi.mocked(isPackageIgnored).mockImplementation(() => false)
    }
  })

  it('skips npm: aliases and git/tarball URL specifiers', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      // An alias must never be looked up under its alias name — 'my-fork' is not
      // the packument that 'npm:real-pkg@^1.0.0' points at.
      dep('my-fork', 'npm:real-pkg@^1.0.0'),
      dep('from-git', 'git+https://github.com/user/repo.git'),
      dep('from-git-proto', 'git://github.com/user/repo.git'),
      dep('tarball', 'https://example.com/pkg-1.0.0.tgz'),
      dep('insecure-tarball', 'http://example.com/pkg-1.0.0.tgz'),
      dep('zod', '^3.0.0'),
    ])
    mocks.fetchPackageVersions.mockImplementation(
      async (packageNames: string[], options: { onPackageReady: (result: any) => void }) => {
        expect(packageNames).toEqual(['zod'])
        options.onPackageReady({
          packageName: 'zod',
          data: { latestVersion: '3.1.0', allVersions: ['3.1.0', '3.0.0'] },
        })
        return new Map([['zod', { latestVersion: '3.1.0', allVersions: ['3.1.0', '3.0.0'] }]])
      }
    )

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages.map((pkg) => pkg.name)).toEqual(['zod'])
  })

  it('treats a package as up to date when ignoreMajor suppresses its only update', async () => {
    const { isPackageIgnored } = await import('../../../../src/shared/config')
    vi.mocked(isPackageIgnored).mockImplementation((name: string, patterns: string[]) =>
      patterns.includes(name)
    )
    try {
      mocks.collectAllDependenciesAsync.mockResolvedValue([dep('@tiptap/core', '^2.0.0')])
      // No in-range update: the only available bump crosses the major boundary.
      mocks.findClosestMinorVersion.mockImplementation(() => null)
      mocks.fetchPackageVersions.mockImplementation(
        async (packageNames: string[], options: { onPackageReady: (result: any) => void }) => {
          const data = { latestVersion: '3.0.0', allVersions: ['3.0.0', '2.0.0'] }
          options.onPackageReady({
            packageName: '@tiptap/core',
            data,
          })
          return new Map(packageNames.map((name) => [name, data]))
        }
      )

      const detector = new PackageDetector({
        cwd: '/repo',
        ignoreMajorPackages: ['@tiptap/core'],
      })
      const packages = await detector.getOutdatedPackages()

      expect(packages).toHaveLength(1)
      expect(packages[0]).toMatchObject({
        name: '@tiptap/core',
        isOutdated: false,
        hasRangeUpdate: false,
        hasMajorUpdate: false,
        majorIgnored: true,
        latestVersion: '3.0.0',
      })
    } finally {
      vi.mocked(isPackageIgnored).mockImplementation(() => false)
    }
  })

  it('keeps the in-range update visible when ignoreMajor suppresses the major', async () => {
    const { isPackageIgnored } = await import('../../../../src/shared/config')
    vi.mocked(isPackageIgnored).mockImplementation((name: string, patterns: string[]) =>
      patterns.includes(name)
    )
    try {
      mocks.collectAllDependenciesAsync.mockResolvedValue([dep('@tiptap/core', '^2.0.0')])
      mocks.findClosestMinorVersion.mockImplementation(() => '2.6.0')
      mocks.fetchPackageVersions.mockImplementation(
        async (packageNames: string[], options: { onPackageReady: (result: any) => void }) => {
          const data = { latestVersion: '3.0.0', allVersions: ['3.0.0', '2.6.0', '2.0.0'] }
          options.onPackageReady({
            packageName: '@tiptap/core',
            data,
          })
          return new Map(packageNames.map((name) => [name, data]))
        }
      )

      const detector = new PackageDetector({
        cwd: '/repo',
        ignoreMajorPackages: ['@tiptap/core'],
      })
      const packages = await detector.getOutdatedPackages()

      expect(packages[0]).toMatchObject({
        isOutdated: true,
        hasRangeUpdate: true,
        rangeVersion: '2.6.0',
        hasMajorUpdate: false,
        majorIgnored: true,
        latestVersion: '3.0.0',
      })
    } finally {
      vi.mocked(isPackageIgnored).mockImplementation(() => false)
    }
  })

  it('leaves majors intact for packages ignoreMajor does not match', async () => {
    const { isPackageIgnored } = await import('../../../../src/shared/config')
    vi.mocked(isPackageIgnored).mockImplementation((name: string, patterns: string[]) =>
      patterns.includes(name)
    )
    try {
      mocks.collectAllDependenciesAsync.mockResolvedValue([dep('react', '^17.0.0')])
      mocks.findClosestMinorVersion.mockImplementation(() => null)
      mocks.fetchPackageVersions.mockImplementation(
        async (packageNames: string[], options: { onPackageReady: (result: any) => void }) => {
          const data = { latestVersion: '18.0.0', allVersions: ['18.0.0', '17.0.0'] }
          options.onPackageReady({ packageName: 'react', data })
          return new Map(packageNames.map((name) => [name, data]))
        }
      )

      const detector = new PackageDetector({
        cwd: '/repo',
        ignoreMajorPackages: ['@tiptap/core'],
      })
      const packages = await detector.getOutdatedPackages()

      expect(packages[0]).toMatchObject({
        name: 'react',
        isOutdated: true,
        hasMajorUpdate: true,
        majorIgnored: false,
      })
    } finally {
      vi.mocked(isPackageIgnored).mockImplementation(() => false)
    }
  })

  it('sorts scoped packages before unscoped ones', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      dep('zod', '^1.0.0'),
      dep('@s/b', '^1.0.0'),
      dep('alpha', '^1.0.0'),
      dep('@s/a', '^1.0.0'),
      dep('beta', '^1.0.0'),
      dep('@s/c', '^1.0.0'),
    ])

    const detector = new PackageDetector({ cwd: '/repo' })
    let uniquePackages: string[] = []
    await detector.streamOutdatedPackages((event) => {
      if (event.type === 'initial') {
        uniquePackages = event.payload.uniquePackages
      }
    })

    expect(uniquePackages).toEqual(['@s/a', '@s/b', '@s/c', 'alpha', 'beta', 'zod'])
  })

  it('logs missing registry data once per package name', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      dep('zod', '^1.0.0', '/repo/packages/a/package.json'),
      dep('zod', '^1.0.0', '/repo/packages/b/package.json'),
    ])
    mocks.fetchPackageVersions.mockImplementation(
      async (_names: string[], options: { onPackageReady: (result: any) => void }) => {
        const data = { latestVersion: 'unknown', allVersions: [] }
        options.onPackageReady({ packageName: 'zod', data })
        return new Map([['zod', data]])
      }
    )

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages).toHaveLength(2)
    expect(packages.every((pkg) => pkg.latestVersion === 'unknown')).toBe(true)
    const noDataLogs = vi
      .mocked(debugLog.warn)
      .mock.calls.filter((call) => String(call[1]).includes('no data returned for zod'))
    expect(noDataLogs).toHaveLength(1)
  })

  it('falls back to raw version strings when semver cannot coerce them', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('zod', 'latest')])
    mocks.findClosestMinorVersion.mockReturnValue('weird-version')
    mocks.fetchPackageVersions.mockImplementation(
      async (_names: string[], options: { onPackageReady: (result: any) => void }) => {
        const data = { latestVersion: 'next', allVersions: ['next'] }
        options.onPackageReady({ packageName: 'zod', data })
        return new Map([['zod', data]])
      }
    )

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages[0]).toMatchObject({
      currentVersion: 'latest',
      rangeVersion: 'weird-version',
      latestVersion: 'next',
      hasMajorUpdate: false,
    })
  })

  it('detects a pure major update when no in-range version exists', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      dep('major-only', '^1.0.0', '/repo/packages/a/package.json'),
      dep('major-only', '^1.0.0', '/repo/packages/b/package.json'),
    ])
    mocks.findClosestMinorVersion.mockReturnValue(null)
    mocks.fetchPackageVersions.mockImplementation(
      async (_names: string[], options: { onPackageReady: (result: any) => void }) => {
        const data = { latestVersion: '2.0.0', allVersions: ['2.0.0', '1.0.0'] }
        options.onPackageReady({ packageName: 'major-only', data })
        return new Map([['major-only', data]])
      }
    )

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages).toHaveLength(2)
    for (const pkg of packages) {
      expect(pkg).toMatchObject({
        isOutdated: true,
        hasRangeUpdate: false,
        hasMajorUpdate: true,
        rangeVersion: '^1.0.0',
      })
    }
    // The same name@version is only announced once even across manifests.
    const outdatedLogs = vi
      .mocked(debugLog.info)
      .mock.calls.filter((call) => String(call[1]).includes('outdated: major-only'))
    expect(outdatedLogs).toHaveLength(1)
    expect(String(outdatedLogs[0][1])).toContain('range:-')
  })

  it('marks a dependency failed when version resolution throws', async () => {
    mocks.findClosestMinorVersion.mockImplementation(() => {
      throw new Error('boom')
    })

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages[0]).toMatchObject({
      name: 'zod',
      latestVersion: 'unknown',
      isOutdated: false,
    })
    expect(debugLog.error).toHaveBeenCalledWith(
      'PackageDetector',
      'error processing zod',
      expect.any(Error)
    )
  })

  it('emits the scanning directory in progress status', async () => {
    const longDir = `/repo/${'deeply-nested/'.repeat(6)}`
    mocks.findAllPackageJsonFilesAsync.mockImplementation(
      async (
        _cwd: string,
        _exclude: string[],
        _depth: number,
        onProgress: (dir: string, found: number) => void
      ) => {
        onProgress(longDir, 3)
        return ['/repo/package.json']
      }
    )

    const detector = new PackageDetector({ cwd: '/repo' })
    const statuses: unknown[] = []
    await detector.streamOutdatedPackages((event) => {
      if (event.type === 'status') statuses.push(event.payload.progress)
    })

    expect(statuses).toContainEqual(
      expect.objectContaining({ scanningDir: longDir, packageJsonFiles: 3 })
    )
  })

  it('stops discovery before collecting dependencies when cancelled', async () => {
    const controller = new AbortController()
    const cancelled = new Error('cancelled scan')
    mocks.findAllPackageJsonFilesAsync.mockImplementation(
      async (
        _cwd: string,
        _exclude: string[],
        _depth: number,
        onProgress: (dir: string, found: number) => void
      ) => {
        controller.abort(cancelled)
        onProgress('/repo', 1)
        return ['/repo/package.json']
      }
    )

    const detector = new PackageDetector({ cwd: '/repo' })
    await expect(detector.streamOutdatedPackages(() => {}, controller.signal)).rejects.toThrow(
      'cancelled scan'
    )
    expect(mocks.collectAllDependenciesAsync).not.toHaveBeenCalled()
    expect(mocks.fetchPackageVersions).not.toHaveBeenCalled()
  })

  it('warns about package.json-bearing directories the default skip list pruned', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mocks.findAllPackageJsonFilesAsync.mockImplementation(
        async (
          _cwd: string,
          _exclude: string[],
          _depth: number,
          _onProgress: unknown,
          options: { onSkippedPackageDir: (dir: string) => void }
        ) => {
          options.onSkippedPackageDir('apps/legacy')
          return ['/repo/package.json']
        }
      )
      await new PackageDetector({ cwd: '/repo' }).getOutdatedPackages()
      expect(warn.mock.calls.flat().join('\n')).toContain('1 package.json-bearing directory')

      warn.mockClear()
      mocks.findAllPackageJsonFilesAsync.mockImplementation(
        async (
          _cwd: string,
          _exclude: string[],
          _depth: number,
          _onProgress: unknown,
          options: { onSkippedPackageDir: (dir: string) => void }
        ) => {
          options.onSkippedPackageDir('apps/legacy')
          options.onSkippedPackageDir('apps/ancient')
          return ['/repo/package.json']
        }
      )
      await new PackageDetector({ cwd: '/repo' }).getOutdatedPackages()
      const message = warn.mock.calls.flat().join('\n')
      expect(message).toContain('2 package.json-bearing directories')
      expect(message).toContain('- apps/ancient')
      expect(message).toContain('- apps/legacy')
    } finally {
      warn.mockRestore()
    }
  })

  it('fails when the file scan times out', async () => {
    vi.useFakeTimers()
    try {
      mocks.findAllPackageJsonFilesAsync.mockImplementation(() => new Promise<string[]>(() => {}))

      const detector = new PackageDetector({ cwd: '/repo' })
      const promise = detector.streamOutdatedPackages(() => {})
      const expectation = expect(promise).rejects.toThrow(
        /Failed to scan for package\.json files: .*Scan timed out after 30000ms/
      )
      await vi.advanceTimersByTimeAsync(30000)
      await expectation
    } finally {
      vi.useRealTimers()
    }
  })

  it('wraps synchronous scanner failures', async () => {
    mocks.findAllPackageJsonFilesAsync.mockImplementation(() => {
      throw new Error('sync boom')
    })

    const detector = new PackageDetector({ cwd: '/repo' })
    await expect(detector.streamOutdatedPackages(() => {})).rejects.toThrow(
      /Failed to scan for package\.json files: .*sync boom/
    )
  })
})

describe('PackageDetector prerelease handling', () => {
  const dep = (name: string, version: string, packageJsonPath = '/repo/package.json') => ({
    name,
    version,
    type: 'dependencies',
    packageJsonPath,
  })

  // A mock registry keyed by package name; values use the real ParsedVersions
  // shape (allVersions = stable only, prereleaseVersions = every channel).
  const mockRegistry = (data: Record<string, unknown>) => {
    mocks.fetchPackageVersions.mockImplementation(
      async (packageNames: string[], options: { onPackageReady: (result: any) => void }) => {
        for (const packageName of packageNames) {
          options.onPackageReady({ packageName, data: data[packageName] })
        }
        return new Map(packageNames.map((name) => [name, data[name]]))
      }
    )
  }

  beforeEach(async () => {
    // These tests exercise the real version arithmetic end to end — restore the
    // actual findClosestMinorVersion behind the suite-wide mock.
    const actualVersions = await vi.importActual<typeof import('../../../../src/shared/versions')>(
      '../../../../src/shared/versions'
    )
    mocks.findClosestMinorVersion.mockReset()
    mocks.findClosestMinorVersion.mockImplementation(actualVersions.findClosestMinorVersion)
    mocks.loadPnpmCatalogs.mockReturnValue(null)
    mocks.findPackageJson.mockReturnValue('/repo/package.json')
    mocks.readPackageJson.mockReturnValue({ name: 'fixture' })
    mocks.findAllPackageJsonFilesAsync.mockReset()
    mocks.findAllPackageJsonFilesAsync.mockResolvedValue(['/repo/package.json'])
    mocks.fetchPackageVersions.mockReset()
  })

  it('reports a newer rc to a beta install (vuetify-nuxt-module bug report)', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      dep('vuetify-nuxt-module', '^1.0.0-beta.2'),
    ])
    mockRegistry({
      'vuetify-nuxt-module': {
        latestVersion: '0.19.5',
        allVersions: ['0.19.5', '0.18.7'],
        prereleaseVersions: [
          '1.0.0-rc.3',
          '1.0.0-rc.1',
          '1.0.0-beta.11',
          '1.0.0-beta.2',
          '1.0.0-alpha.6',
        ],
      },
    })

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages).toHaveLength(1)
    expect(packages[0]).toMatchObject({
      name: 'vuetify-nuxt-module',
      currentVersion: '^1.0.0-beta.2',
      isOutdated: true,
      hasRangeUpdate: true,
      rangeVersion: '1.0.0-rc.3',
      hasMajorUpdate: false,
      latestVersion: '1.0.0-rc.3',
    })
    // The candidate pool carries same-tuple prereleases for downstream targets
    expect(packages[0].allVersions).toEqual([
      '1.0.0-rc.3',
      '1.0.0-rc.1',
      '1.0.0-beta.11',
      '1.0.0-beta.2',
      '1.0.0-alpha.6',
      '0.19.5',
      '0.18.7',
    ])
  })

  it('reports a newer preview build to a preview install (next-style tags)', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('next', '16.0.0-preview.9')])
    mockRegistry({
      next: {
        latestVersion: '15.5.4',
        allVersions: ['15.5.4', '15.5.3'],
        prereleaseVersions: ['16.0.0-preview.10', '16.0.0-preview.9', '16.0.0-preview.8'],
      },
    })

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages[0]).toMatchObject({
      isOutdated: true,
      hasRangeUpdate: true,
      rangeVersion: '16.0.0-preview.10',
      hasMajorUpdate: false,
      latestVersion: '16.0.0-preview.10',
    })
  })

  it('never surfaces prereleases to a stable install', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('lib', '^1.2.0')])
    mockRegistry({
      lib: {
        latestVersion: '1.2.0',
        allVersions: ['1.2.0', '1.1.0'],
        prereleaseVersions: ['2.0.0-beta.1', '1.3.0-rc.1'],
      },
    })

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages[0]).toMatchObject({
      isOutdated: false,
      hasRangeUpdate: false,
      hasMajorUpdate: false,
      latestVersion: '1.2.0',
    })
    expect(packages[0].allVersions).toEqual(['1.2.0', '1.1.0'])
  })

  it('offers both the same-tuple rc and the newer stable major to a beta install', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('lib', '^1.0.0-beta.2')])
    mockRegistry({
      lib: {
        latestVersion: '2.0.0',
        allVersions: ['2.0.0', '0.19.5'],
        prereleaseVersions: ['1.0.0-rc.3', '1.0.0-beta.2'],
      },
    })

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages[0]).toMatchObject({
      isOutdated: true,
      hasRangeUpdate: true,
      rangeVersion: '1.0.0-rc.3',
      hasMajorUpdate: true,
      latestVersion: '2.0.0',
    })
  })

  it('keeps the prerelease range bump when ignoreMajor suppresses the stable major', async () => {
    const { isPackageIgnored } = await import('../../../../src/shared/config')
    vi.mocked(isPackageIgnored).mockImplementation((name: string, patterns: string[]) =>
      patterns.includes(name)
    )
    try {
      mocks.collectAllDependenciesAsync.mockResolvedValue([dep('lib', '^1.0.0-beta.2')])
      mockRegistry({
        lib: {
          latestVersion: '2.0.0',
          allVersions: ['2.0.0', '0.19.5'],
          prereleaseVersions: ['1.0.0-rc.3', '1.0.0-beta.2'],
        },
      })

      const detector = new PackageDetector({ cwd: '/repo', ignoreMajorPackages: ['lib'] })
      const packages = await detector.getOutdatedPackages()

      expect(packages[0]).toMatchObject({
        isOutdated: true,
        hasRangeUpdate: true,
        rangeVersion: '1.0.0-rc.3',
        hasMajorUpdate: false,
        majorIgnored: true,
      })
    } finally {
      vi.mocked(isPackageIgnored).mockImplementation(() => false)
    }
  })

  it('reports prerelease-only packages unavailable to a STABLE install', async () => {
    // Hard invariant: a stable install is never offered a prerelease, even
    // when the package has zero stable publishes — same behavior as before
    // prerelease support (unavailable), not a ^1.0.0-alpha.2 suggestion.
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('early-lib', '^0.9.0')])
    mockRegistry({
      'early-lib': {
        latestVersion: '1.0.0-alpha.2',
        allVersions: [],
        prereleaseVersions: ['1.0.0-alpha.2', '1.0.0-alpha.1'],
      },
    })

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages[0]).toMatchObject({
      isOutdated: false,
      hasRangeUpdate: false,
      hasMajorUpdate: false,
      latestVersion: 'unknown',
      rangeVersion: 'unknown',
    })
  })

  it('treats wildcard specifiers as up to date instead of resolving them to 0.0.0', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('anything-goes', 'x')])
    mockRegistry({
      'anything-goes': { latestVersion: '2.5.1', allVersions: ['2.5.1', '1.0.0'] },
    })

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages[0]).toMatchObject({
      isOutdated: false,
      hasRangeUpdate: false,
      hasMajorUpdate: false,
    })
  })

  it('surfaces a same-major cross-tuple prerelease as the latest update', async () => {
    // 1.0.0-beta.2 installed, the project moved on to 1.1.0-alpha.1: no
    // same-tuple bump exists and no major is crossed, but latest must still
    // show it — otherwise headless --target latest writes a version the
    // interactive UI never displayed.
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('lib', '^1.0.0-beta.2')])
    mockRegistry({
      lib: {
        latestVersion: '0.19.5',
        allVersions: ['0.19.5'],
        prereleaseVersions: ['1.1.0-alpha.1', '1.0.0-beta.2'],
      },
    })

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages[0]).toMatchObject({
      isOutdated: true,
      hasRangeUpdate: false,
      hasMajorUpdate: true,
      latestVersion: '1.1.0-alpha.1',
    })
  })

  it('does not let ignoreMajor suppress a same-major prerelease latest', async () => {
    const { isPackageIgnored } = await import('../../../../src/shared/config')
    vi.mocked(isPackageIgnored).mockImplementation((name: string, patterns: string[]) =>
      patterns.includes(name)
    )
    try {
      mocks.collectAllDependenciesAsync.mockResolvedValue([dep('lib', '^1.0.0-beta.2')])
      mockRegistry({
        lib: {
          latestVersion: '0.19.5',
          allVersions: ['0.19.5'],
          prereleaseVersions: ['1.1.0-alpha.1', '1.0.0-beta.2'],
        },
      })

      const detector = new PackageDetector({ cwd: '/repo', ignoreMajorPackages: ['lib'] })
      const packages = await detector.getOutdatedPackages()

      // 1.0.0-beta.2 → 1.1.0-alpha.1 never crosses a major; ignoreMajor must
      // not hide it.
      expect(packages[0]).toMatchObject({
        hasMajorUpdate: true,
        majorIgnored: false,
        latestVersion: '1.1.0-alpha.1',
      })
    } finally {
      vi.mocked(isPackageIgnored).mockImplementation(() => false)
    }
  })

  it('resolves prerelease-only packages instead of marking them unavailable', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('early-lib', '^1.0.0-beta.1')])
    mockRegistry({
      'early-lib': {
        latestVersion: '1.0.0-beta.2',
        allVersions: [],
        prereleaseVersions: ['1.0.0-beta.2', '1.0.0-beta.1'],
      },
    })

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages[0]).toMatchObject({
      isOutdated: true,
      hasRangeUpdate: true,
      rangeVersion: '1.0.0-beta.2',
      latestVersion: '1.0.0-beta.2',
    })
  })

  it('falls back to the reported latest when the version lists are empty', async () => {
    // Degenerate blob: a latest version but no version lists at all. The
    // effective-latest computation must fall back rather than crash or blank.
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('lib', '^1.0.0-beta.2')])
    mockRegistry({
      lib: { latestVersion: '1.0.0-rc.3', allVersions: [] },
    })

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages[0]).toMatchObject({
      latestVersion: '1.0.0-rc.3',
      hasRangeUpdate: false,
    })
  })

  it('tolerates registry data without a prereleaseVersions field (pre-v2 shape)', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('lib', '^1.0.0-beta.2')])
    mockRegistry({
      lib: { latestVersion: '0.19.5', allVersions: ['0.19.5'] },
    })

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages[0]).toMatchObject({
      isOutdated: false,
      hasRangeUpdate: false,
      hasMajorUpdate: false,
    })
  })
})

describe('PackageDetector concurrency plumbing', () => {
  const originalController = process.env.INUP_CONTROLLER
  const originalNetProfile = process.env.INUP_NET_PROFILE

  const storedProfile = {
    schemaVersion: 1 as const,
    learnedLimit: 6,
    baselineLatencyMs: 350,
    baselineGoodputRps: 8.5,
    sampleCount: 120,
    updatedAt: new Date().toISOString(),
  }

  let fetchOptions: Record<string, unknown>

  beforeEach(() => {
    delete process.env.INUP_CONTROLLER
    delete process.env.INUP_NET_PROFILE
    mocks.getNetworkProfile.mockReset()
    mocks.getNetworkProfile.mockReturnValue(null)
    mocks.setNetworkProfile.mockReset()
    mocks.loadPnpmCatalogs.mockReturnValue(null)
    mocks.findPackageJson.mockReturnValue('/repo/package.json')
    mocks.readPackageJson.mockReturnValue({ name: 'fixture' })
    mocks.findAllPackageJsonFilesAsync.mockResolvedValue(['/repo/package.json'])
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      {
        name: 'zod',
        version: '^1.0.0',
        type: 'dependencies',
        packageJsonPath: '/repo/package.json',
      },
    ])
    mocks.findClosestMinorVersion.mockImplementation(
      (version: string, versions: string[]) => versions[0] ?? version
    )
    mocks.fetchPackageVersions.mockReset()
    mocks.fetchPackageVersions.mockImplementation(
      async (_packageNames: string[], options: Record<string, unknown>) => {
        fetchOptions = options
        return new Map()
      }
    )
  })

  afterEach(() => {
    if (originalController === undefined) delete process.env.INUP_CONTROLLER
    else process.env.INUP_CONTROLLER = originalController
    if (originalNetProfile === undefined) delete process.env.INUP_NET_PROFILE
    else process.env.INUP_NET_PROFILE = originalNetProfile
  })

  const run = async (options?: ConstructorParameters<typeof PackageDetector>[0]) => {
    const detector = new PackageDetector({ cwd: '/repo', ...options })
    await detector.streamOutdatedPackages(() => {})
    return detector
  }

  it('passes a pinned concurrency through to the registry fetcher', async () => {
    await run({ concurrency: 5 })
    expect(fetchOptions.concurrency).toBe(5)
  })

  it('defaults to the hillclimb controller', async () => {
    await run()
    expect(fetchOptions.controllerMode).toBe('hillclimb')
  })

  it('INUP_CONTROLLER=aimd selects the control arm', async () => {
    process.env.INUP_CONTROLLER = 'aimd'
    await run()
    expect(fetchOptions.controllerMode).toBe('aimd')
  })

  it('injects the stored network profile', async () => {
    mocks.getNetworkProfile.mockReturnValue(storedProfile)
    await run()
    expect(fetchOptions.networkProfile).toEqual(storedProfile)
  })

  it('persists the settled profile via onNetworkProfile', async () => {
    await run()
    const onNetworkProfile = fetchOptions.onNetworkProfile as (p: unknown) => void
    expect(onNetworkProfile).toBeTypeOf('function')
    onNetworkProfile(storedProfile)
    expect(mocks.setNetworkProfile).toHaveBeenCalledWith(storedProfile)
  })

  it('INUP_NET_PROFILE=0 disables both profile read and write', async () => {
    process.env.INUP_NET_PROFILE = '0'
    mocks.getNetworkProfile.mockReturnValue(storedProfile)
    await run()
    expect(fetchOptions.networkProfile).toBeNull()
    expect(fetchOptions.onNetworkProfile).toBeUndefined()
  })

  it('exposes the new knobs in the perf config', async () => {
    mocks.getNetworkProfile.mockReturnValue(storedProfile)
    const detector = await run({ concurrency: 7 })
    expect(detector.getPerfConfig()).toMatchObject({
      controllerMode: 'hillclimb',
      pinnedConcurrency: 7,
      hadNetworkProfile: true,
      profileLearnedLimit: 6,
    })
  })

  const streamWithTick = async (tick: Record<string, unknown>) => {
    const flags: (boolean | undefined)[] = []
    const data = { latestVersion: '2.0.0', allVersions: ['2.0.0'] }
    mocks.fetchPackageVersions.mockImplementation(
      async (_packageNames: string[], options: Record<string, any>) => {
        options.onControlTick(tick)
        options.onPackageReady({ packageName: 'zod', data })
        return new Map([['zod', data]])
      }
    )
    const detector = new PackageDetector({ cwd: '/repo' })
    await detector.streamOutdatedPackages((event) => {
      if (event.type === 'package') flags.push(event.payload.progress.slowNetwork)
    })
    return flags
  }

  it('marks progress slowNetwork when the controller settled low', async () => {
    const flags = await streamWithTick({
      atMs: 1,
      limit: 4,
      ewmaMs: 300,
      retries: 0,
      reason: 'step-down',
      state: 'hold',
      goodputRps: 8,
    })
    expect(flags).toEqual([true])
  })

  it('leaves slowNetwork false on a healthy link', async () => {
    const flags = await streamWithTick({
      atMs: 1,
      limit: 24,
      ewmaMs: 40,
      retries: 0,
      reason: 'hold',
      state: 'hold',
      goodputRps: 300,
    })
    expect(flags).toEqual([false])
  })

  it('marks the firstResult phase when the first package streams in', async () => {
    mocks.performanceTracker.mark.mockClear()
    await streamWithTick({
      atMs: 1,
      limit: 24,
      ewmaMs: 40,
      retries: 0,
      reason: 'hold',
      state: 'hold',
      goodputRps: 300,
    })
    expect(mocks.performanceTracker.mark).toHaveBeenCalledWith('firstResult')
  })
})

describe('PackageDetector release-age cooldown', () => {
  const NOW = Date.parse('2024-06-01T12:00:00.000Z')
  const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString()

  const dep = (name: string, version: string, packageJsonPath = '/repo/package.json') => ({
    name,
    version,
    type: 'dependencies',
    packageJsonPath,
  })

  const mockRegistry = (data: Record<string, unknown>) => {
    mocks.fetchPackageVersions.mockImplementation(
      async (packageNames: string[], options: { onPackageReady: (result: any) => void }) => {
        for (const packageName of packageNames) {
          options.onPackageReady({ packageName, data: data[packageName] })
        }
        return new Map(packageNames.map((name) => [name, data[name]]))
      }
    )
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    // One test swaps in the real matcher; restore the suite-wide stub so it cannot leak.
    const { isPackageIgnored } = await import('../../../../src/shared/config')
    vi.mocked(isPackageIgnored).mockImplementation(() => false)
    const actualVersions = await vi.importActual<typeof import('../../../../src/shared/versions')>(
      '../../../../src/shared/versions'
    )
    mocks.findClosestMinorVersion.mockReset()
    mocks.findClosestMinorVersion.mockImplementation(actualVersions.findClosestMinorVersion)
    mocks.loadPnpmCatalogs.mockReturnValue(null)
    mocks.findPackageJson.mockReturnValue('/repo/package.json')
    mocks.readPackageJson.mockReturnValue({ name: 'fixture' })
    mocks.findAllPackageJsonFilesAsync.mockReset()
    mocks.findAllPackageJsonFilesAsync.mockResolvedValue(['/repo/package.json'])
    mocks.fetchPackageVersions.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('only requests the full packument when the cooldown is enabled', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('axios', '^1.0.0')])
    mockRegistry({ axios: { latestVersion: '1.0.0', allVersions: ['1.0.0'] } })

    await new PackageDetector({ cwd: '/repo' }).getOutdatedPackages()
    expect(mocks.fetchPackageVersions.mock.calls[0][1]).toMatchObject({ fullMetadata: false })

    mocks.fetchPackageVersions.mockClear()
    mockRegistry({ axios: { latestVersion: '1.0.0', allVersions: ['1.0.0'] } })
    await new PackageDetector({ cwd: '/repo', minimumReleaseAge: 60 }).getOutdatedPackages()
    expect(mocks.fetchPackageVersions.mock.calls[0][1]).toMatchObject({ fullMetadata: true })
  })

  it('withholds a too-fresh stable release and falls back to the newest eligible one', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('axios', '^1.0.0')])
    mockRegistry({
      axios: {
        latestVersion: '1.2.0',
        allVersions: ['1.2.0', '1.1.0', '1.0.0'],
        publishTimes: {
          '1.2.0': minutesAgo(5),
          '1.1.0': minutesAgo(10_000),
          '1.0.0': minutesAgo(20_000),
        },
      },
    })

    const packages = await new PackageDetector({
      cwd: '/repo',
      minimumReleaseAge: 60,
    }).getOutdatedPackages()

    expect(packages[0]).toMatchObject({ latestVersion: '1.1.0', rangeVersion: '1.1.0' })
    expect(packages[0].heldByCooldown).toEqual({
      version: '1.2.0',
      publishedAt: minutesAgo(5),
      ageMinutes: 5,
      count: 1,
    })
  })

  it('withholds a too-fresh PRERELEASE from a prerelease install', async () => {
    // The gap PR #87 left open: gating only the stable pool lets a compromised
    // prerelease straight through for anyone on the prerelease channel.
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('early-lib', '^1.0.0-beta.2')])
    mockRegistry({
      'early-lib': {
        latestVersion: '0.9.0',
        allVersions: ['0.9.0'],
        prereleaseVersions: ['1.0.0-rc.3', '1.0.0-beta.2'],
        publishTimes: {
          '0.9.0': minutesAgo(20_000),
          '1.0.0-rc.3': minutesAgo(5),
          '1.0.0-beta.2': minutesAgo(20_000),
        },
      },
    })

    const packages = await new PackageDetector({
      cwd: '/repo',
      minimumReleaseAge: 60,
    }).getOutdatedPackages()

    expect(packages[0].latestVersion).not.toBe('1.0.0-rc.3')
    expect(packages[0].isOutdated).toBe(false)
    expect(packages[0].heldByCooldown).toMatchObject({ version: '1.0.0-rc.3', count: 1 })
  })

  it('never falls back onto the prerelease pool when every stable release is too fresh', () => {
    // A package with stable publishes must not silently switch channels just
    // because its recent stable releases are inside the window.
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('axios', '^1.0.0')])
    mockRegistry({
      axios: {
        latestVersion: '1.1.0',
        allVersions: ['1.1.0'],
        prereleaseVersions: ['2.0.0-beta.1'],
        publishTimes: {
          '1.1.0': minutesAgo(5),
          '2.0.0-beta.1': minutesAgo(20_000),
        },
      },
    })

    return new PackageDetector({ cwd: '/repo', minimumReleaseAge: 60 })
      .getOutdatedPackages()
      .then((packages) => {
        expect(packages[0]).toMatchObject({ latestVersion: '1.0.0', isOutdated: false })
      })
  })

  it('drops deprecation and engines signals when the cooldown changes the latest', () => {
    // Those signals describe the true latest; attributing them to an older
    // effective latest would be a lie.
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('axios', '^1.0.0')])
    mockRegistry({
      axios: {
        latestVersion: '1.2.0',
        allVersions: ['1.2.0', '1.1.0'],
        deprecated: 'use something else',
        enginesNode: '>=22',
        publishTimes: { '1.2.0': minutesAgo(5), '1.1.0': minutesAgo(20_000) },
      },
    })

    return new PackageDetector({ cwd: '/repo', minimumReleaseAge: 60 })
      .getOutdatedPackages()
      .then((packages) => {
        expect(packages[0].deprecated).toBeUndefined()
        expect(packages[0].enginesNode).toBeUndefined()
      })
  })

  it('keeps health signals when the cooldown withheld only versions below the latest', () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('axios', '^1.0.0')])
    mockRegistry({
      axios: {
        latestVersion: '1.2.0',
        allVersions: ['1.2.0', '1.1.0'],
        deprecated: 'use something else',
        publishTimes: { '1.2.0': minutesAgo(20_000), '1.1.0': minutesAgo(5) },
      },
    })

    return new PackageDetector({ cwd: '/repo', minimumReleaseAge: 60 })
      .getOutdatedPackages()
      .then((packages) => {
        expect(packages[0].latestVersion).toBe('1.2.0')
        expect(packages[0].deprecated).toBe('use something else')
      })
  })

  it('logs one gate line per (package, specifier), not one per workspace manifest', async () => {
    // A monorepo declaring the same dependency in five manifests describes ONE gate.
    // Repeating it per location turns the debug log into noise at exactly the moment
    // someone is reading it to understand why an upgrade disappeared.
    vi.mocked(debugLog.info).mockClear()
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      dep('axios', '^1.0.0', '/repo/packages/a/package.json'),
      dep('axios', '^1.0.0', '/repo/packages/b/package.json'),
      dep('axios', '^1.0.0', '/repo/packages/c/package.json'),
    ])
    mockRegistry({
      axios: {
        latestVersion: '1.2.0',
        allVersions: ['1.2.0', '1.0.0'],
        publishTimes: { '1.2.0': minutesAgo(5), '1.0.0': minutesAgo(10_000) },
      },
    })

    const packages = await new PackageDetector({
      cwd: '/repo',
      minimumReleaseAge: 60,
    }).getOutdatedPackages()

    // Every location still carries the hold — each names a different file.
    expect(packages.filter((pkg) => pkg.heldByCooldown !== undefined)).toHaveLength(3)
    const gateLogs = vi
      .mocked(debugLog.info)
      .mock.calls.filter((call) => String(call[1]).includes('release-age gate'))
    expect(gateLogs).toHaveLength(1)
    expect(String(gateLogs[0][1])).toContain('1 version(s) of axios')
  })

  it('does not report a withheld PRERELEASE to a stable install', async () => {
    // The stable install can never be offered 7.0.0-dev.1, so naming it as held back
    // would invent a missed upgrade that was never on the table. The gate still applies
    // to both channels — only the reporting narrows.
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('typescript', '^6.0.0')])
    mockRegistry({
      typescript: {
        latestVersion: '6.0.3',
        allVersions: ['6.0.3'],
        prereleaseVersions: ['7.0.0-dev.1'],
        publishTimes: {
          '6.0.3': minutesAgo(10_000),
          '7.0.0-dev.1': minutesAgo(5),
        },
      },
    })

    const packages = await new PackageDetector({
      cwd: '/repo',
      minimumReleaseAge: 60,
    }).getOutdatedPackages()

    expect(packages[0]).toMatchObject({ name: 'typescript', latestVersion: '6.0.3' })
    expect(packages[0].heldByCooldown).toBeUndefined()
    // The prerelease is still withheld from the pool the resolver sees.
    expect(packages[0].allVersions).not.toContain('7.0.0-dev.1')
  })

  it('does report a withheld prerelease to a prerelease install', async () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('typescript', '^7.0.0-dev.1')])
    mockRegistry({
      typescript: {
        latestVersion: '6.0.3',
        allVersions: ['6.0.3'],
        prereleaseVersions: ['7.0.0-dev.2', '7.0.0-dev.1'],
        publishTimes: {
          '6.0.3': minutesAgo(10_000),
          '7.0.0-dev.2': minutesAgo(5),
          '7.0.0-dev.1': minutesAgo(10_000),
        },
      },
    })

    const packages = await new PackageDetector({
      cwd: '/repo',
      minimumReleaseAge: 60,
    }).getOutdatedPackages()

    expect(packages[0].heldByCooldown).toMatchObject({ version: '7.0.0-dev.2', count: 1 })
  })

  it('exempts packages matching minimumReleaseAgeExclude', async () => {
    // The suite-wide mock stubs isPackageIgnored to false; this case is entirely
    // about the matcher firing, so restore the real implementation.
    const actualConfig = await vi.importActual<typeof import('../../../../src/shared/config')>(
      '../../../../src/shared/config'
    )
    const { isPackageIgnored } = await import('../../../../src/shared/config')
    vi.mocked(isPackageIgnored).mockImplementation(actualConfig.isPackageIgnored)

    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('@myco/ui', '^1.0.0')])
    mockRegistry({
      '@myco/ui': {
        latestVersion: '1.2.0',
        allVersions: ['1.2.0', '1.0.0'],
        publishTimes: { '1.2.0': minutesAgo(5), '1.0.0': minutesAgo(20_000) },
      },
    })

    return new PackageDetector({
      cwd: '/repo',
      minimumReleaseAge: 60,
      minimumReleaseAgeExclude: ['@myco/*'],
    })
      .getOutdatedPackages()
      .then((packages) => {
        expect(packages[0].latestVersion).toBe('1.2.0')
        expect(packages[0].heldByCooldown).toBeUndefined()
      })
  })

  it('is inert when disabled or when nothing falls inside the window', () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('axios', '^1.0.0')])
    mockRegistry({
      axios: {
        latestVersion: '1.2.0',
        allVersions: ['1.2.0', '1.0.0'],
        publishTimes: { '1.2.0': minutesAgo(20_000), '1.0.0': minutesAgo(30_000) },
      },
    })

    return new PackageDetector({ cwd: '/repo', minimumReleaseAge: 60 })
      .getOutdatedPackages()
      .then((packages) => {
        expect(packages[0].latestVersion).toBe('1.2.0')
        expect(packages[0].heldByCooldown).toBeUndefined()
      })
  })

  it('stays silent when the withheld version is older than the one being offered', () => {
    // A withheld version below the effective latest was never going to be offered,
    // so announcing it would be a false alarm on a control whose value is that its
    // alarms mean something.
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('axios', '^1.0.0')])
    mockRegistry({
      axios: {
        latestVersion: '1.2.0',
        allVersions: ['1.2.0', '1.1.0', '1.0.0'],
        publishTimes: { '1.1.0': minutesAgo(5), '1.0.0': minutesAgo(20_000) },
      },
    })

    return new PackageDetector({ cwd: '/repo', minimumReleaseAge: 60 })
      .getOutdatedPackages()
      .then((packages) => {
        // 1.2.0 has no timestamp so it stays eligible and remains the latest — the
        // withheld 1.1.0 is behind it and irrelevant to this user.
        expect(packages[0].latestVersion).toBe('1.2.0')
        expect(packages[0].heldByCooldown).toBeUndefined()
      })
  })

  it('falls back on the PRERELEASE channel for a prerelease-only package', () => {
    // The package has zero stable publishes, so its true latest is a prerelease.
    // The fallback must stay on that channel rather than jumping to a stable pool
    // that does not exist.
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('early-lib', '^1.0.0-alpha.1')])
    mockRegistry({
      'early-lib': {
        latestVersion: '1.0.0-alpha.3',
        allVersions: [],
        prereleaseVersions: ['1.0.0-alpha.3', '1.0.0-alpha.2', '1.0.0-alpha.1'],
        publishTimes: {
          '1.0.0-alpha.3': minutesAgo(5),
          '1.0.0-alpha.2': minutesAgo(20_000),
          '1.0.0-alpha.1': minutesAgo(30_000),
        },
      },
    })

    return new PackageDetector({ cwd: '/repo', minimumReleaseAge: 60 })
      .getOutdatedPackages()
      .then((packages) => {
        expect(packages[0].latestVersion).toBe('1.0.0-alpha.2')
        expect(packages[0].heldByCooldown).toMatchObject({ version: '1.0.0-alpha.3' })
      })
  })

  it('reports nothing to upgrade to when EVERY prerelease of a prerelease-only package is too fresh', () => {
    // Brand-new prerelease-only package: the whole pool is inside the window, so
    // the installed version becomes the effective latest rather than the run
    // offering a version the cooldown just withheld.
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('brand-new', '^1.0.0-alpha.1')])
    mockRegistry({
      'brand-new': {
        latestVersion: '1.0.0-alpha.2',
        allVersions: [],
        prereleaseVersions: ['1.0.0-alpha.2', '1.0.0-alpha.1'],
        publishTimes: {
          '1.0.0-alpha.2': minutesAgo(5),
          '1.0.0-alpha.1': minutesAgo(10),
        },
      },
    })

    return new PackageDetector({ cwd: '/repo', minimumReleaseAge: 60 })
      .getOutdatedPackages()
      .then((packages) => {
        expect(packages[0]).toMatchObject({
          latestVersion: '1.0.0-alpha.1',
          isOutdated: false,
        })
        // Only alpha.2 counts: alpha.1 is the version already installed, so calling it
        // "held back" would count the status quo as a missed upgrade.
        expect(packages[0].heldByCooldown).toMatchObject({
          version: '1.0.0-alpha.2',
          count: 1,
        })
      })
  })

  it('falls back to the raw specifier when the installed version is unparsable', () => {
    // A wildcard pins nothing, so parseCurrentVersion returns null and there is no
    // clean installed version to fall back to.
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('anything-goes', 'x')])
    mockRegistry({
      'anything-goes': {
        latestVersion: '2.5.1',
        allVersions: ['2.5.1'],
        publishTimes: { '2.5.1': minutesAgo(5) },
      },
    })

    return new PackageDetector({ cwd: '/repo', minimumReleaseAge: 60 })
      .getOutdatedPackages()
      .then((packages) => {
        expect(packages[0]).toMatchObject({ latestVersion: 'x', isOutdated: false })
        expect(packages[0].heldByCooldown).toMatchObject({ version: '2.5.1' })
      })
  })

  it('reports the cooldown as unsupported when no packument carried publish times', () => {
    // The policy fails open on missing `time`, so an inert cooldown produces an empty
    // held list — byte-identical to "every version is old enough". Callers need to be
    // able to tell those apart, or a disabled control reads as a passing check.
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('axios', '^1.0.0')])
    mockRegistry({
      axios: { latestVersion: '2.0.0', allVersions: ['2.0.0', '1.0.0'] },
    })

    const detector = new PackageDetector({ cwd: '/repo', minimumReleaseAge: 60 })
    return detector.getOutdatedPackages().then((packages) => {
      expect(packages[0].latestVersion).toBe('2.0.0')
      expect(packages[0].heldByCooldown).toBeUndefined()
      expect(detector.getCooldownDiagnostics()).toEqual({
        minimumReleaseAge: 60,
        publishTimesAvailable: false,
      })
    })
  })

  it('reports the cooldown as supported once any packument carried publish times', () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      dep('axios', '^1.0.0'),
      dep('lodash', '^4.0.0'),
    ])
    mockRegistry({
      axios: { latestVersion: '2.0.0', allVersions: ['2.0.0'] },
      lodash: {
        latestVersion: '4.1.0',
        allVersions: ['4.1.0'],
        publishTimes: { '4.1.0': minutesAgo(20_000) },
      },
    })

    const detector = new PackageDetector({ cwd: '/repo', minimumReleaseAge: 60 })
    return detector.getOutdatedPackages().then(() => {
      expect(detector.getCooldownDiagnostics()).toMatchObject({ publishTimesAvailable: true })
    })
  })

  it('reports no diagnostics at all when the cooldown is disabled', () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('axios', '^1.0.0')])
    mockRegistry({ axios: { latestVersion: '2.0.0', allVersions: ['2.0.0'] } })

    const detector = new PackageDetector({ cwd: '/repo' })
    return detector.getOutdatedPackages().then(() => {
      expect(detector.getCooldownDiagnostics()).toBeNull()
    })
  })

  it('does not blame the registry when nothing resolved at all', () => {
    // A total fetch failure is not evidence that the registry lacks publish times.
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('axios', '^1.0.0')])
    mockRegistry({ axios: { latestVersion: 'unknown', allVersions: [] } })

    const detector = new PackageDetector({ cwd: '/repo', minimumReleaseAge: 60 })
    return detector.getOutdatedPackages().then(() => {
      expect(detector.getCooldownDiagnostics()).toMatchObject({ publishTimesAvailable: true })
    })
  })

  it('counts every withheld version across both channels', () => {
    mocks.collectAllDependenciesAsync.mockResolvedValue([dep('early-lib', '^1.0.0-beta.1')])
    mockRegistry({
      'early-lib': {
        latestVersion: '1.0.0',
        allVersions: ['1.0.0', '0.9.0'],
        prereleaseVersions: ['1.1.0-rc.1', '1.0.0-beta.1'],
        publishTimes: {
          '1.0.0': minutesAgo(5),
          '0.9.0': minutesAgo(20_000),
          '1.1.0-rc.1': minutesAgo(5),
          '1.0.0-beta.1': minutesAgo(20_000),
        },
      },
    })

    return new PackageDetector({ cwd: '/repo', minimumReleaseAge: 60 })
      .getOutdatedPackages()
      .then((packages) => {
        expect(packages[0].heldByCooldown).toMatchObject({ version: '1.1.0-rc.1', count: 2 })
      })
  })
})
