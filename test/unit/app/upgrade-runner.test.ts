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
  appendOutdatedBatchToSelectionStates: vi.fn(),
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
    appendOutdatedBatchToSelectionStates = mocks.appendOutdatedBatchToSelectionStates
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
    mocks.appendOutdatedBatchToSelectionStates.mockImplementation(() => {})

    mocks.streamOutdatedPackages.mockImplementation(async (onEvent: any) => {
      const progress = {
        discovered: 1,
        resolved: 0,
        total: 1,
        failed: 0,
        isLoading: true,
      }

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

  it('appends streamed batches to the selection UI and refreshes it', async () => {
    const batchPackage = {
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
        type: 'batch',
        payload: {
          batch: [{ packageName: 'next', packageInfo: [batchPackage], failed: false }],
          progress: { ...progress, resolved: 1 },
        },
      })
      // A second batch for the same package replaces the earlier entry
      // instead of duplicating it.
      onEvent({
        type: 'batch',
        payload: {
          batch: [{ packageName: 'next', packageInfo: [batchPackage], failed: false }],
          progress: { ...progress, resolved: 1 },
        },
      })
      onEvent({
        type: 'complete',
        payload: {
          packages: [batchPackage],
          progress: { ...progress, resolved: 1, isLoading: false },
        },
      })
    })
    const refresh = vi.fn()
    mocks.selectPackagesToUpgradeProgressive.mockImplementation(
      async (_states: any, _progress: any, onReady: (refresh: () => void) => void) => {
        onReady(refresh)
        return []
      }
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()

    expect(mocks.appendOutdatedBatchToSelectionStates).toHaveBeenCalledTimes(2)
    // Once per batch, once for completion.
    expect(refresh).toHaveBeenCalledTimes(3)
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
    const batchPackage = {
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
    // The stream delivers one batch but never completes: progress stays loading.
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
        type: 'batch',
        payload: {
          batch: [{ packageName: 'next', packageInfo: [batchPackage], failed: false }],
          progress: { ...progress, resolved: 1 },
        },
      })
    })
    mocks.selectPackagesToUpgradeProgressive
      .mockImplementationOnce(async (_states: any, _progress: any, onReady: any) => {
        onReady(vi.fn())
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
        onReady(vi.fn())
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
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('🚀 inup'))
    expect(mocks.upgradePackages).not.toHaveBeenCalled()
  })
})
