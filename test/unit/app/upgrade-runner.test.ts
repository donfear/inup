import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  streamOutdatedPackages: vi.fn(),
  getOutdatedPackagesOnly: vi.fn(),
  hasPackageJson: vi.fn(),
  getPerfConfig: vi.fn(),
  selectPackagesToUpgradeProgressive: vi.fn(),
  selectPackagesToUpgrade: vi.fn(),
  confirmUpgrade: vi.fn(),
  upgradePackages: vi.fn(),
  clearProgress: vi.fn(),
  detectPackageManager: vi.fn(),
  insertOutdatedPackage: vi.fn(),
  isPerfLoggingEnabled: vi.fn(() => false),
  writePerfLog: vi.fn(),
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
    getPerfConfig = mocks.getPerfConfig
  },
}))

vi.mock('../../../src/features/debug', () => ({
  getPerformanceTracker: () => mocks.performanceTracker,
  isPerfLoggingEnabled: mocks.isPerfLoggingEnabled,
  perfEnv: () => ({}),
  writePerfLog: mocks.writePerfLog,
}))

vi.mock('../../../src/app/interactive-ui', () => ({
  InteractiveUI: class {
    selectPackagesToUpgradeProgressive = mocks.selectPackagesToUpgradeProgressive
    selectPackagesToUpgrade = mocks.selectPackagesToUpgrade
    confirmUpgrade = mocks.confirmUpgrade
    insertOutdatedPackage = mocks.insertOutdatedPackage
  },
}))

vi.mock('../../../src/features/upgrade/upgrader', () => ({
  PackageUpgrader: class {
    upgradePackages = mocks.upgradePackages
  },
}))

vi.mock('../../../src/shared/package-manager', () => ({
  PackageManagerDetector: {
    detect: mocks.detectPackageManager,
    getInfo: mocks.detectPackageManager,
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
    mocks.insertOutdatedPackage.mockImplementation(() => {})

    mocks.streamOutdatedPackages.mockImplementation(async (onEvent: any) => {
      const progress = {
        phase: 'resolving',
        discovered: 1,
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

  it('propagates the slowNetwork flag into the live progress object', async () => {
    let seenProgress: { slowNetwork?: boolean } | undefined
    const snapshotsAtPackage: (boolean | undefined)[] = []
    mocks.selectPackagesToUpgradeProgressive.mockImplementation(
      async (_states: unknown, progress: { slowNetwork?: boolean }) => {
        seenProgress = progress
        return []
      }
    )
    mocks.insertOutdatedPackage.mockImplementation(() => {
      snapshotsAtPackage.push(seenProgress?.slowNetwork)
    })
    mocks.streamOutdatedPackages.mockImplementation(async (onEvent: any) => {
      onEvent({
        type: 'initial',
        payload: {
          allDependencies: [],
          uniquePackages: ['next'],
          currentVersions: new Map(),
          progress: { discovered: 1, resolved: 0, total: 1, failed: 0, isLoading: true },
        },
      })
      onEvent({
        type: 'package',
        payload: {
          packageName: 'next',
          packageInfo: [],
          progress: {
            discovered: 1,
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
            discovered: 1,
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
          progress: { discovered: 0, resolved: 0, total: 0, failed: 0, isLoading: true },
        },
      })
      onEvent({
        type: 'complete',
        payload: {
          packages: [],
          progress: { discovered: 0, resolved: 0, total: 0, failed: 0, isLoading: false },
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

  it('uses the forced package manager instead of detecting one', () => {
    new UpgradeRunner({ cwd: '/repo', packageManager: 'pnpm' })
    expect(mocks.detectPackageManager).toHaveBeenCalledWith('pnpm')
  })

  it('defaults to process.cwd() when constructed without options', () => {
    new UpgradeRunner()
    expect(mocks.detectPackageManager).toHaveBeenCalledWith(process.cwd())
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
      const progress = { discovered: 2, resolved: 0, total: 2, failed: 0, isLoading: true }
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

    expect(mocks.insertOutdatedPackage).toHaveBeenCalledTimes(2)
    expect(mocks.insertOutdatedPackage.mock.calls[1][1]).toEqual([
      { ...streamedPackage, name: 'zod' },
    ])
    // Once per package event, once for completion.
    expect(refresh).toHaveBeenCalledTimes(4)
    expect(mocks.getOutdatedPackagesOnly).toHaveBeenCalledWith(completed)
    logSpy.mockRestore()
  })

  it('writes a perf log on completion when perf logging is enabled', async () => {
    mocks.isPerfLoggingEnabled.mockReturnValue(true)
    mocks.getPerfConfig.mockReturnValue({ cwd: '/repo' })
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()

    expect(mocks.writePerfLog).toHaveBeenCalledTimes(1)
    expect(mocks.writePerfLog).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'interactive', packageManager: 'yarn' }),
      expect.anything()
    )
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
      const progress = { discovered: 1, resolved: 0, total: 1, failed: 0, isLoading: true }
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
