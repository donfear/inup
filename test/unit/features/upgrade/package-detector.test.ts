import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findPackageJson: vi.fn(),
  readPackageJson: vi.fn(),
  findAllPackageJsonFilesAsync: vi.fn(),
  collectAllDependenciesAsync: vi.fn(),
  findClosestMinorVersion: vi.fn(),
  fetchPackageVersions: vi.fn(),
  loadPnpmCatalogs: vi.fn(),
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

import { PackageDetector } from '../../../../src/features/upgrade/package-detector'

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
  })

  it('skips catalog entries whose resolved range is a workspace reference', async () => {
    mocks.loadPnpmCatalogs.mockReturnValue({
      path: '/repo/pnpm-workspace.yaml',
      resolve: () => ({ catalog: 'default', range: 'workspace:*' }),
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
  })

  it('applies the ignore list to catalog entries', async () => {
    const { isPackageIgnored } = await import('../../../../src/shared/config')
    vi.mocked(isPackageIgnored).mockImplementation((name: string) => name === 'react')
    try {
      mocks.loadPnpmCatalogs.mockReturnValue({
        path: '/repo/pnpm-workspace.yaml',
        resolve: () => ({ catalog: 'default', range: '^18.0.0' }),
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
