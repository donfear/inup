import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  streamOutdatedPackages: vi.fn(),
  getOutdatedPackagesOnly: vi.fn(),
  hasPackageJson: vi.fn(),
  getCooldownDiagnostics: vi.fn(() => null),
  selectPackagesToUpgradeProgressive: vi.fn(),
  selectPackagesToUpgrade: vi.fn(),
  confirmUpgrade: vi.fn(),
  upgradePackages: vi.fn(),
  clearProgress: vi.fn(),
  detectPackageManager: vi.fn(),
  insertResolvedPackages: vi.fn(),
  setCooldownHeldCount: vi.fn(),
  setCooldownUnsupported: vi.fn(),
  performanceTracker: {
    start: vi.fn(),
    setPackageManager: vi.fn(),
    mark: vi.fn(),
    snapshot: vi.fn(() => ({})),
  },
}))

vi.mock('../../../src/features/upgrade/package-detector', () => ({
  PackageDetector: class {
    streamOutdatedPackages = mocks.streamOutdatedPackages
    getOutdatedPackagesOnly = mocks.getOutdatedPackagesOnly
    hasPackageJson = mocks.hasPackageJson
    getCooldownDiagnostics = mocks.getCooldownDiagnostics
  },
}))

vi.mock('../../../src/features/debug', () => ({
  getPerformanceTracker: () => mocks.performanceTracker,
}))

vi.mock('../../../src/app/interactive-ui', () => ({
  InteractiveUI: class {
    selectPackagesToUpgradeProgressive = mocks.selectPackagesToUpgradeProgressive
    selectPackagesToUpgrade = mocks.selectPackagesToUpgrade
    confirmUpgrade = mocks.confirmUpgrade
    insertResolvedPackages = mocks.insertResolvedPackages
    setCooldownHeldCount = mocks.setCooldownHeldCount
    setCooldownUnsupported = mocks.setCooldownUnsupported
  },
}))

vi.mock('../../../src/features/upgrade/upgrader', () => ({
  PackageUpgrader: class {
    upgradePackages = mocks.upgradePackages
  },
}))

vi.mock('../../../src/shared/package-manager', () => ({
  PackageManagerDetector: {
    resolve: mocks.detectPackageManager,
  },
}))

vi.mock('../../../src/shared/terminal', () => ({
  ConsoleUtils: {
    clearProgress: mocks.clearProgress,
  },
}))

import { UpgradeRunner } from '../../../src/app/upgrade-runner'
import type { PackageLoadProgress, StreamOutdatedPackagesCallback } from '../../../src/shared/types'

describe('UpgradeRunner terminal handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.hasPackageJson.mockReturnValue(true)
    mocks.detectPackageManager.mockReturnValue({
      name: 'yarn',
      displayName: 'yarn',
      lockFile: 'yarn.lock',
      workspaceFile: null,
      installCommand: 'yarn install',
      color: null,
    })
    mocks.getOutdatedPackagesOnly.mockImplementation((packages: any[]) => packages)
    mocks.insertResolvedPackages.mockImplementation(() => {})

    mocks.streamOutdatedPackages.mockImplementation(async (onEvent: any) => {
      const progress = {
        phase: 'resolving',
        resolved: 0,
        total: 1,
        failed: 0,
        isLoading: true,
      }

      onEvent({ type: 'status', payload: { progress: { ...progress, phase: 'discovering' } } })

      onEvent({
        type: 'initial',
        payload: {
          allDependencies: [],
          uniquePackages: ['next'],
          currentVersions: new Map([['next', '^1.0.0']]),
          progress,
        },
      })

      onEvent({ type: 'status', payload: { progress } })
      onEvent({
        type: 'complete',
        payload: {
          packages: [
            {
              name: 'next',
              currentVersion: '^1.0.0',
              rangeVersion: '^1.1.0',
              latestVersion: '^2.0.0',
              type: 'dependencies',
              packageJsonPath: '/repo/package.json',
              isOutdated: true,
              hasRangeUpdate: true,
              hasMajorUpdate: true,
            },
          ],
          progress: {
            ...progress,
            resolved: 1,
            isLoading: false,
          },
        },
      })
    })
  })

  it('names cooldown-held packages instead of stopping at "up to date"', async () => {
    // A package whose every newer version is inside the window is not outdated,
    // so it never reaches the picker. Saying only "up to date" would hide it.
    const heldPackage = {
      name: 'axios',
      currentVersion: '^1.0.0',
      rangeVersion: '1.0.0',
      latestVersion: '1.0.0',
      type: 'dependencies',
      packageJsonPath: '/repo/package.json',
      isOutdated: false,
      hasRangeUpdate: false,
      hasMajorUpdate: false,
      heldByCooldown: {
        version: '1.1.0',
        publishedAt: '2024-06-01T00:00:00.000Z',
        ageMinutes: 12,
        count: 1,
      },
    }
    mocks.streamOutdatedPackages.mockImplementation(async (onEvent: any) => {
      onEvent({
        type: 'complete',
        payload: {
          packages: [heldPackage],
          progress: { resolved: 1, total: 1, failed: 0, isLoading: false },
        },
      })
    })
    mocks.getOutdatedPackagesOnly.mockReturnValue([])
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('up to date'))
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 package(s) have a newer version held by the release-age cooldown')
    )
    // Fully-held packages are absent from the list, so the header carries the count.
    expect(mocks.setCooldownHeldCount).toHaveBeenCalledWith(1)
    logSpy.mockRestore()
  })

  it('counts a workspace-wide hold once in the header, not once per location', async () => {
    const held = {
      version: '1.1.0',
      publishedAt: '2024-06-01T00:00:00.000Z',
      ageMinutes: 12,
      count: 1,
    }
    const inWorkspace = (packageJsonPath: string) => ({
      name: 'axios',
      currentVersion: '^1.0.0',
      rangeVersion: '1.0.0',
      latestVersion: '1.0.0',
      type: 'dependencies',
      packageJsonPath,
      isOutdated: false,
      hasRangeUpdate: false,
      hasMajorUpdate: false,
      heldByCooldown: held,
    })
    mocks.streamOutdatedPackages.mockImplementation(async (onEvent: any) => {
      onEvent({
        type: 'complete',
        payload: {
          packages: [
            inWorkspace('/repo/package.json'),
            inWorkspace('/repo/apps/web/package.json'),
            inWorkspace('/repo/apps/api/package.json'),
          ],
          progress: { resolved: 1, total: 1, failed: 0, isLoading: false },
        },
      })
    })
    mocks.getOutdatedPackagesOnly.mockReturnValue([])
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()

    expect(mocks.setCooldownHeldCount).toHaveBeenCalledWith(1)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 package(s) have a newer'))
    logSpy.mockRestore()
  })

  it('excludes partially-held packages from the header count (they have their own row)', async () => {
    const partiallyHeld = {
      name: 'axios',
      currentVersion: '^1.0.0',
      rangeVersion: '1.1.0',
      latestVersion: '1.1.0',
      type: 'dependencies',
      packageJsonPath: '/repo/package.json',
      isOutdated: true,
      hasRangeUpdate: true,
      hasMajorUpdate: false,
      heldByCooldown: {
        version: '2.0.0',
        publishedAt: '2024-06-01T00:00:00.000Z',
        ageMinutes: 12,
        count: 1,
      },
    }
    mocks.streamOutdatedPackages.mockImplementation(async (onEvent: any) => {
      onEvent({
        type: 'package',
        payload: {
          packageName: 'axios',
          packageInfo: [partiallyHeld],
          progress: { resolved: 1, total: 1, failed: 0, isLoading: true },
        },
      })
    })
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()

    expect(mocks.setCooldownHeldCount).toHaveBeenCalledWith(0)
    logSpy.mockRestore()
  })

  it('tells the picker when the cooldown could not act', async () => {
    // Fails open on missing publish times, so the picker must distinguish an inert
    // cooldown from a satisfied one.
    mocks.getCooldownDiagnostics.mockReturnValue({
      minimumReleaseAge: 10080,
      publishTimesAvailable: false,
    })
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()

    expect(mocks.setCooldownUnsupported).toHaveBeenCalledWith(true)
    logSpy.mockRestore()
  })

  it('reports the cooldown as active when the registry supplies publish times', async () => {
    mocks.getCooldownDiagnostics.mockReturnValue({
      minimumReleaseAge: 10080,
      publishTimesAvailable: true,
    })
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()

    expect(mocks.setCooldownUnsupported).toHaveBeenCalledWith(false)
    logSpy.mockRestore()
  })

  it('propagates the slowNetwork flag into the live progress object', async () => {
    let seenProgress: { slowNetwork?: boolean } | undefined
    const snapshotsAtPackage: (boolean | undefined)[] = []
    mocks.selectPackagesToUpgradeProgressive.mockImplementation(
      async (_states: unknown, progress: { slowNetwork?: boolean }) => {
        seenProgress = progress
        return []
      }
    )
    mocks.insertResolvedPackages.mockImplementation(() => {
      snapshotsAtPackage.push(seenProgress?.slowNetwork)
    })
    mocks.streamOutdatedPackages.mockImplementation(async (onEvent: any) => {
      onEvent({
        type: 'initial',
        payload: {
          allDependencies: [],
          uniquePackages: ['next'],
          currentVersions: new Map(),
          progress: { resolved: 0, total: 1, failed: 0, isLoading: true },
        },
      })
      onEvent({
        type: 'package',
        payload: {
          packageName: 'next',
          packageInfo: [],
          progress: {
            resolved: 1,
            total: 1,
            failed: 0,
            isLoading: true,
            slowNetwork: true,
          },
        },
      })
      onEvent({
        type: 'complete',
        payload: {
          packages: [],
          progress: {
            resolved: 1,
            total: 1,
            failed: 0,
            isLoading: false,
            slowNetwork: false,
          },
        },
      })
    })
    mocks.getOutdatedPackagesOnly.mockReturnValue([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()
    logSpy.mockRestore()

    // The UI holds one live progress object; the hint must arrive through it.
    expect(snapshotsAtPackage).toEqual([true])
    expect(seenProgress?.slowNetwork).toBe(false) // and clear again on recovery
  })

  it('mounts before discovery, refreshes scan status, and defers warnings until screen release', async () => {
    const order: string[] = []
    let liveProgress!: PackageLoadProgress
    let finish!: () => void
    const refresh = vi.fn(() => order.push(liveProgress.phase))
    mocks.selectPackagesToUpgradeProgressive.mockImplementation((_selection, progress, ready) => {
      liveProgress = progress
      order.push('mounted')
      expect(progress.phase).toBe('discovering')
      ready({ refresh, abort: vi.fn() })
      return new Promise((resolve) => {
        finish = () => {
          order.push('released')
          ready(undefined)
          resolve([])
        }
      })
    })
    mocks.streamOutdatedPackages.mockImplementation(
      async (onEvent: StreamOutdatedPackagesCallback) => {
        expect(order).toEqual(['mounted'])
        onEvent({
          type: 'status',
          payload: { progress: { ...liveProgress, phase: 'collecting', packageJsonFiles: 2 } },
        })
        onEvent({ type: 'warning', payload: { message: 'Skipped directory' } })
        expect(order).toEqual(['mounted', 'collecting'])
        onEvent({
          type: 'complete',
          payload: { packages: [], progress: { ...liveProgress, phase: 'done', isLoading: false } },
        })
        finish()
      }
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      order.push('warning')
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await new UpgradeRunner({ cwd: '/repo' }).run()
      expect(order).toEqual(['mounted', 'collecting', 'done', 'released', 'warning'])
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Everything is up to date'))
    } finally {
      warn.mockRestore()
      log.mockRestore()
    }
  })

  it('releases the session before reporting a scan failure', async () => {
    const order: string[] = []
    let rejectUI!: (error: unknown) => void
    const abort = vi.fn((error) => {
      order.push('released')
      rejectUI(error)
    })
    mocks.selectPackagesToUpgradeProgressive.mockImplementation((_selection, _progress, ready) => {
      ready({ refresh: vi.fn(), abort })
      return new Promise((_resolve, reject) => {
        rejectUI = reject
      })
    })
    const error = new Error('scan failed')
    mocks.streamOutdatedPackages.mockRejectedValue(error)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      order.push('error')
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
    try {
      await new UpgradeRunner({ cwd: '/repo' }).run()
      expect(abort).toHaveBeenCalledWith(error)
      expect(order).toEqual(['released', 'error'])
      expect(exit).toHaveBeenCalledWith(1)
    } finally {
      log.mockRestore()
      exit.mockRestore()
    }
  })

  it('cancels background discovery on early quit without claiming everything is current', async () => {
    let signal!: AbortSignal
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([])
    mocks.streamOutdatedPackages.mockImplementation(
      (_onEvent: unknown, scanSignal: AbortSignal) => {
        signal = scanSignal
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        )
      }
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await new UpgradeRunner({ cwd: '/repo' }).run()
      await Promise.resolve()
      expect(signal.aborted).toBe(true)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Nothing selected'))
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Everything is up to date'))
      expect(error).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
      error.mockRestore()
    }
  })

  it('reports a stream failure that arrives while confirmation is open', async () => {
    const emitDefaultEvents = mocks.streamOutdatedPackages.getMockImplementation()!
    let failScan!: (error: unknown) => void
    mocks.streamOutdatedPackages.mockImplementation(
      async (onEvent: StreamOutdatedPackagesCallback) => {
        await emitDefaultEvents(onEvent)
        await new Promise((_resolve, reject) => {
          failScan = reject
        })
      }
    )
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([
      {
        name: 'next',
        packageJsonPath: '/repo/package.json',
        dependencyType: 'dependencies',
        upgradeType: 'range',
        targetVersion: '^1.1.0',
        currentVersionSpecifier: '^1.0.0',
      },
    ])
    mocks.confirmUpgrade.mockImplementation(async () => {
      failScan(new Error('late stream failure'))
      await new Promise((resolve) => setImmediate(resolve))
      return true
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
    try {
      await new UpgradeRunner({ cwd: '/repo' }).run()
      expect(error).toHaveBeenCalledWith(expect.stringContaining('late stream failure'))
      expect(mocks.upgradePackages).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
      log.mockRestore()
      exit.mockRestore()
    }
  })

  it('exits early with up-to-date message when no outdated packages', async () => {
    mocks.streamOutdatedPackages.mockImplementation(async (onEvent: any) => {
      onEvent({
        type: 'initial',
        payload: {
          allDependencies: [],
          uniquePackages: [],
          currentVersions: new Map(),
          progress: { resolved: 0, total: 0, failed: 0, isLoading: true },
        },
      })
      onEvent({
        type: 'complete',
        payload: {
          packages: [],
          progress: { resolved: 0, total: 0, failed: 0, isLoading: false },
        },
      })
    })
    mocks.getOutdatedPackagesOnly.mockReturnValue([])
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('up to date'))
    expect(mocks.upgradePackages).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('exits with "No packages selected" when selection returns empty', async () => {
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing selected'))
    expect(mocks.upgradePackages).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('exits with "Upgrade cancelled" when user declines confirmation', async () => {
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([
      {
        name: 'next',
        packageJsonPath: '/repo/package.json',
        dependencyType: 'dependencies',
        upgradeType: 'range',
        targetVersion: '^1.1.0',
        currentVersionSpecifier: '^1.0.0',
      },
    ])
    mocks.confirmUpgrade.mockResolvedValue(false)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Upgrade cancelled'))
    expect(mocks.upgradePackages).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('calls upgradePackages when user confirms', async () => {
    const choice = {
      name: 'next',
      packageJsonPath: '/repo/package.json',
      dependencyType: 'dependencies',
      upgradeType: 'range',
      targetVersion: '^1.1.0',
      currentVersionSpecifier: '^1.0.0',
    }
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([choice])
    mocks.confirmUpgrade.mockResolvedValue(true)
    mocks.upgradePackages.mockResolvedValue(undefined)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()
    expect(mocks.upgradePackages).toHaveBeenCalledTimes(1)
    logSpy.mockRestore()
  })

  it('calls process.exit(1) when no package.json is found', async () => {
    mocks.hasPackageJson.mockReturnValue(false)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await new UpgradeRunner({ cwd: '/no-pkg' }).run()

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No package.json'))
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('resolves the package manager from its options (override or detection)', () => {
    new UpgradeRunner({ cwd: '/repo', packageManager: 'pnpm' })
    expect(mocks.detectPackageManager).toHaveBeenCalledWith({
      cwd: '/repo',
      packageManager: 'pnpm',
    })
  })

  it('appends each streamed package to the selection UI and refreshes it', async () => {
    const streamedPackage = {
      name: 'next',
      currentVersion: '^1.0.0',
      rangeVersion: '^1.1.0',
      latestVersion: '^2.0.0',
      type: 'dependencies',
      packageJsonPath: '/repo/package.json',
      isOutdated: true,
      hasRangeUpdate: true,
      hasMajorUpdate: true,
    }
    // The detector's final list is authoritative once loading completes.
    const completed = [streamedPackage, { ...streamedPackage, name: 'zod' }]
    mocks.streamOutdatedPackages.mockImplementation(async (onEvent: any) => {
      const progress = { resolved: 0, total: 2, failed: 0, isLoading: true }
      onEvent({
        type: 'initial',
        payload: {
          allDependencies: [],
          uniquePackages: ['next', 'zod'],
          currentVersions: new Map([['next', '^1.0.0']]),
          progress,
        },
      })
      onEvent({
        type: 'package',
        payload: {
          packageName: 'next',
          packageInfo: [streamedPackage],
          progress: { ...progress, resolved: 1 },
        },
      })
      onEvent({
        type: 'package',
        payload: {
          packageName: 'zod',
          packageInfo: [{ ...streamedPackage, name: 'zod' }],
          progress: { ...progress, resolved: 2 },
        },
      })
      onEvent({
        type: 'complete',
        payload: {
          packages: completed,
          progress: { ...progress, resolved: 2, isLoading: false },
        },
      })
    })
    const refresh = vi.fn()
    mocks.selectPackagesToUpgradeProgressive.mockImplementation(
      async (_states: any, _progress: any, onReady: (refresh: () => void) => void) => {
        onReady({ refresh, abort: vi.fn() } as any)
        return []
      }
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()

    expect(mocks.insertResolvedPackages).toHaveBeenCalledTimes(2)
    expect(mocks.insertResolvedPackages.mock.calls[1][1]).toEqual([
      { ...streamedPackage, name: 'zod' },
    ])
    // Once per package event, once for completion.
    expect(refresh).toHaveBeenCalledTimes(4)
    expect(mocks.getOutdatedPackagesOnly).toHaveBeenCalledWith(completed)
    logSpy.mockRestore()
  })

  it('re-enters progressive selection when declining confirmation while still loading', async () => {
    const streamedPackage = {
      name: 'next',
      currentVersion: '^1.0.0',
      rangeVersion: '^1.1.0',
      latestVersion: '^2.0.0',
      type: 'dependencies',
      packageJsonPath: '/repo/package.json',
      isOutdated: true,
      hasRangeUpdate: true,
      hasMajorUpdate: true,
    }
    // The stream delivers one package but never completes: progress stays loading.
    mocks.streamOutdatedPackages.mockImplementation(async (onEvent: any) => {
      const progress = { resolved: 0, total: 1, failed: 0, isLoading: true }
      onEvent({
        type: 'initial',
        payload: {
          allDependencies: [],
          uniquePackages: ['next'],
          currentVersions: new Map([['next', '^1.0.0']]),
          progress,
        },
      })
      onEvent({
        type: 'package',
        payload: {
          packageName: 'next',
          packageInfo: [streamedPackage],
          progress: { ...progress, resolved: 1 },
        },
      })
    })
    mocks.selectPackagesToUpgradeProgressive
      .mockImplementationOnce(async (_states: any, _progress: any, onReady: any) => {
        onReady({ refresh: vi.fn(), abort: vi.fn() })
        return [
          {
            name: 'next',
            packageJsonPath: '/repo/package.json',
            dependencyType: 'dependencies',
            upgradeType: 'range',
            targetVersion: '^1.1.0',
            currentVersionSpecifier: '^1.0.0',
          },
        ]
      })
      .mockImplementationOnce(async (_states: any, _progress: any, onReady: any) => {
        onReady({ refresh: vi.fn(), abort: vi.fn() })
        return []
      })
    mocks.confirmUpgrade.mockResolvedValueOnce(null)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()

    expect(mocks.selectPackagesToUpgradeProgressive).toHaveBeenCalledTimes(2)
    expect(mocks.selectPackagesToUpgrade).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing selected'))
    logSpy.mockRestore()
  })

  it('rejects selections that no longer match a known package', async () => {
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([
      {
        name: 'ghost',
        packageJsonPath: '/repo/package.json',
        dependencyType: 'dependencies',
        upgradeType: 'range',
        targetVersion: '',
        currentVersionSpecifier: '^1.0.0',
      },
    ])
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await new UpgradeRunner({ cwd: '/repo' }).run()

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid selections detected'))
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      errorSpy.mockRestore()
      logSpy.mockRestore()
    }
  })

  it('summarizes major-only upgrades in the confirmation banner', async () => {
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([
      {
        name: 'next',
        packageJsonPath: '/repo/package.json',
        dependencyType: 'dependencies',
        upgradeType: 'latest',
        targetVersion: '^2.0.0',
        currentVersionSpecifier: '^1.0.0',
      },
    ])
    mocks.confirmUpgrade.mockResolvedValue(true)
    mocks.upgradePackages.mockResolvedValue(undefined)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()

    const logged = logSpy.mock.calls.flat().join('\n')
    expect(logged).toContain('1 major upgrade(s)')
    expect(logged).not.toContain('minor/patch upgrade(s)')
    expect(mocks.upgradePackages).toHaveBeenCalledTimes(1)
    logSpy.mockRestore()
  })

  it('does not print a standalone banner when returning from confirmation to selection', async () => {
    const selectedChoices = [
      {
        name: 'next',
        packageJsonPath: '/repo/package.json',
        dependencyType: 'dependencies',
        upgradeType: 'range',
        targetVersion: '^1.1.0',
        currentVersionSpecifier: '^1.0.0',
      },
    ]

    mocks.selectPackagesToUpgradeProgressive.mockResolvedValueOnce(selectedChoices)
    mocks.selectPackagesToUpgrade.mockResolvedValueOnce(selectedChoices)
    mocks.confirmUpgrade.mockResolvedValueOnce(null).mockResolvedValueOnce(false)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const clearSpy = vi.spyOn(console, 'clear').mockImplementation(() => {})

    await new UpgradeRunner({ cwd: '/repo' }).run()

    expect(mocks.clearProgress).toHaveBeenCalledTimes(1)
    expect(mocks.selectPackagesToUpgradeProgressive).toHaveBeenCalledTimes(1)
    expect(mocks.selectPackagesToUpgrade).toHaveBeenCalledTimes(1)
    expect(clearSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('inup'))
    expect(mocks.upgradePackages).not.toHaveBeenCalled()
  })
})
