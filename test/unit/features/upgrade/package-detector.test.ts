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
    recordControlTick: vi.fn(),
    recordPackageTiming: vi.fn(),
    recordFailedPackage: vi.fn(),
    recordBatch: vi.fn(),
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
          onBatchReady: (batch: any[]) => void
          batchSize: number
          maxConcurrency: number
        }
      ) => {
        expect(packageNames).toEqual(['@scope/pkg', 'zod'])
        expect(options.batchSize).toBe(10)
        expect(options.maxConcurrency).toBe(10)
        const onBatchReady = options.onBatchReady

        onBatchReady([
          {
            packageName: '@scope/pkg',
            data: { latestVersion: '2.0.0', allVersions: ['1.2.0', '1.0.0'] },
            completed: 1,
            total: 2,
            batchIndex: 0,
            itemIndex: 0,
          },
        ])

        onBatchReady([
          {
            packageName: 'zod',
            data: { latestVersion: 'unknown', allVersions: [] },
            completed: 2,
            total: 2,
            batchIndex: 0,
            itemIndex: 1,
          },
        ])

        return new Map([
          ['@scope/pkg', { latestVersion: '2.0.0', allVersions: ['1.2.0', '1.0.0'] }],
          ['zod', { latestVersion: 'unknown', allVersions: [] }],
        ])
      }
    )
  })

  it('emits initial, batch, and complete events in stable order', async () => {
    const detector = new PackageDetector({ cwd: '/repo' })
    const eventTypes: string[] = []
    const batchPackageNames: string[][] = []

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

      if (event.type === 'batch') {
        batchPackageNames.push(event.payload.batch.map((item) => item.packageName))
      }

      if (event.type === 'complete') {
        expect(event.payload.progress).toMatchObject({
          total: 2,
          resolved: 2,
          failed: 1,
          isLoading: false,
        })
      }
    })

    expect(eventTypes).toEqual(['initial', 'batch', 'batch', 'complete'])
    expect(batchPackageNames).toEqual([['@scope/pkg'], ['zod']])
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
      async (packageNames: string[], options: { onBatchReady: (batch: any[]) => void }) => {
        expect(packageNames).toEqual(['react'])
        const data = { latestVersion: '19.1.0', allVersions: ['19.1.0', '18.3.0', '18.2.0'] }
        options.onBatchReady([
          { packageName: 'react', data, completed: 1, total: 1, batchIndex: 0, itemIndex: 0 },
        ])
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
      async (packageNames: string[], options: { onBatchReady: (batch: any[]) => void }) => {
        expect(packageNames).toEqual(['shared-lib'])
        const data = { latestVersion: '1.2.0', allVersions: ['1.2.0', '1.0.0'] }
        options.onBatchReady([
          { packageName: 'shared-lib', data, completed: 1, total: 1, batchIndex: 0, itemIndex: 0 },
        ])
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
      async (packageNames: string[], options: { onBatchReady: (batch: any[]) => void }) => {
        const data = { latestVersion: '2.0.0', allVersions: ['2.0.0', '1.2.0', '1.0.0'] }
        options.onBatchReady(
          packageNames.map((packageName, itemIndex) => ({
            packageName,
            data,
            completed: itemIndex + 1,
            total: packageNames.length,
            batchIndex: 0,
            itemIndex,
          }))
        )
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
      batchSize: 10,
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

  it('records perf callbacks when perf logging is enabled', async () => {
    mocks.isPerfLoggingEnabled.mockReturnValue(true)
    mocks.collectAllDependenciesAsync.mockResolvedValue([
      dep('zod', '^1.0.0'),
      dep('never-resolved', '^1.0.0'),
    ])
    mocks.fetchPackageVersions.mockImplementation(
      async (
        _packageNames: string[],
        options: {
          onBatchReady: (batch: any[]) => void
          onControlTick: (tick: unknown) => void
          onPackageTiming?: (name: string, latencyMs: number) => void
        }
      ) => {
        options.onControlTick({ inFlight: 1 })
        expect(options.onPackageTiming).toBeDefined()
        options.onPackageTiming!('zod', 12)
        const data = { latestVersion: '2.0.0', allVersions: ['2.0.0', '1.0.0'] }
        // Only one of the two packages ever gets a batch: the other must fall
        // back to an empty group in the final assembly.
        options.onBatchReady([
          { packageName: 'zod', data, completed: 1, total: 2, batchIndex: 0, itemIndex: 0 },
        ])
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

  it('pluralizes the found-files progress message', async () => {
    mocks.findAllPackageJsonFilesAsync.mockResolvedValue([
      '/repo/package.json',
      '/repo/packages/a/package.json',
    ])

    const detector = new PackageDetector({ cwd: '/repo' })
    await detector.getOutdatedPackages()

    expect(vi.mocked(ConsoleUtils.showProgress).mock.calls.flat()).toContain(
      '🔍 Found 2 package.json files'
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
      async (packageNames: string[], options: { onBatchReady: (batch: any[]) => void }) => {
        expect(packageNames).toEqual(['zod'])
        options.onBatchReady([
          {
            packageName: 'zod',
            data: { latestVersion: '3.1.0', allVersions: ['3.1.0', '3.0.0'] },
            completed: 1,
            total: 1,
            batchIndex: 0,
            itemIndex: 0,
          },
        ])
        return new Map([['zod', { latestVersion: '3.1.0', allVersions: ['3.1.0', '3.0.0'] }]])
      }
    )

    const detector = new PackageDetector({ cwd: '/repo' })
    const packages = await detector.getOutdatedPackages()

    expect(packages.map((pkg) => pkg.name)).toEqual(['zod'])
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
      async (_names: string[], options: { onBatchReady: (batch: any[]) => void }) => {
        const data = { latestVersion: 'unknown', allVersions: [] }
        options.onBatchReady([
          { packageName: 'zod', data, completed: 1, total: 1, batchIndex: 0, itemIndex: 0 },
        ])
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
      async (_names: string[], options: { onBatchReady: (batch: any[]) => void }) => {
        const data = { latestVersion: 'next', allVersions: ['next'] }
        options.onBatchReady([
          { packageName: 'zod', data, completed: 1, total: 1, batchIndex: 0, itemIndex: 0 },
        ])
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
      async (_names: string[], options: { onBatchReady: (batch: any[]) => void }) => {
        const data = { latestVersion: '2.0.0', allVersions: ['2.0.0', '1.0.0'] }
        options.onBatchReady([
          { packageName: 'major-only', data, completed: 1, total: 1, batchIndex: 0, itemIndex: 0 },
        ])
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

  it('truncates long directory names in scan progress', async () => {
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
    await detector.getOutdatedPackages()

    const progressCalls = vi.mocked(ConsoleUtils.showProgress).mock.calls.flat()
    const truncated = progressCalls.find((msg) => String(msg).includes('(found 3)'))
    expect(truncated).toContain(`...${longDir.slice(-47)}`)
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
})
