import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findPackageJson: vi.fn(),
  readPackageJson: vi.fn(),
  findAllPackageJsonFilesAsync: vi.fn(),
  collectAllDependenciesAsync: vi.fn(),
  findClosestMinorVersion: vi.fn(),
  getAllPackageDataBatched: vi.fn(),
}))

vi.mock('../../../src/utils', () => ({
  findPackageJson: mocks.findPackageJson,
  readPackageJson: mocks.readPackageJson,
  findAllPackageJsonFilesAsync: mocks.findAllPackageJsonFilesAsync,
  collectAllDependenciesAsync: mocks.collectAllDependenciesAsync,
  findClosestMinorVersion: mocks.findClosestMinorVersion,
  debugLog: {
    info: vi.fn(),
    perf: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../../src/services', () => ({
  getAllPackageDataBatched: mocks.getAllPackageDataBatched,
}))

vi.mock('../../../src/config', () => ({
  isPackageIgnored: vi.fn(() => false),
}))

vi.mock('../../../src/ui/utils', () => ({
  ConsoleUtils: {
    showProgress: vi.fn(),
    clearProgress: vi.fn(),
  },
}))

import { PackageDetector } from '../../../src/core/package-detector'

describe('PackageDetector streaming', () => {
  beforeEach(() => {
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
    mocks.findClosestMinorVersion.mockImplementation((version: string, versions: string[]) => versions[0] ?? version)
    mocks.getAllPackageDataBatched.mockImplementation(
      async (
        packageNames: string[],
        onBatchReady: (batch: any[]) => void,
        _currentVersions: Map<string, string>,
        options: { batchSize: number; concurrency: number }
      ) => {
        expect(packageNames).toEqual(['@scope/pkg', 'zod'])
        expect(options).toEqual({ batchSize: 10, concurrency: 5 })

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
})
