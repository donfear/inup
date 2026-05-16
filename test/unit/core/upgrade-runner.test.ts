import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  streamOutdatedPackages: vi.fn(),
  getOutdatedPackagesOnly: vi.fn(),
  hasPackageJson: vi.fn(),
  selectPackagesToUpgradeProgressive: vi.fn(),
  selectPackagesToUpgrade: vi.fn(),
  confirmUpgrade: vi.fn(),
  upgradePackages: vi.fn(),
  clearProgress: vi.fn(),
  detectPackageManager: vi.fn(),
  appendOutdatedBatchToSelectionStates: vi.fn(),
}))

vi.mock('../../../src/core/package-detector', () => ({
  PackageDetector: class {
    streamOutdatedPackages = mocks.streamOutdatedPackages
    getOutdatedPackagesOnly = mocks.getOutdatedPackagesOnly
    hasPackageJson = mocks.hasPackageJson
  },
}))

vi.mock('../../../src/interactive-ui', () => ({
  InteractiveUI: class {
    selectPackagesToUpgradeProgressive = mocks.selectPackagesToUpgradeProgressive
    selectPackagesToUpgrade = mocks.selectPackagesToUpgrade
    confirmUpgrade = mocks.confirmUpgrade
    appendOutdatedBatchToSelectionStates = mocks.appendOutdatedBatchToSelectionStates
  },
}))

vi.mock('../../../src/core/upgrader', () => ({
  PackageUpgrader: class {
    upgradePackages = mocks.upgradePackages
  },
}))

vi.mock('../../../src/services/package-manager-detector', () => ({
  PackageManagerDetector: {
    detect: mocks.detectPackageManager,
    getInfo: mocks.detectPackageManager,
  },
}))

vi.mock('../../../src/ui/utils', () => ({
  ConsoleUtils: {
    clearProgress: mocks.clearProgress,
  },
}))

import { UpgradeRunner } from '../../../src/core/upgrade-runner'

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
      onEvent({ type: 'initial', payload: { allDependencies: [], uniquePackages: [], currentVersions: new Map(), progress: { discovered: 0, resolved: 0, total: 0, failed: 0, isLoading: true } } })
      onEvent({ type: 'complete', payload: { packages: [], progress: { discovered: 0, resolved: 0, total: 0, failed: 0, isLoading: false } } })
    })
    mocks.getOutdatedPackagesOnly.mockReturnValue([])
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('All packages are up to date'))
    expect(mocks.upgradePackages).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('exits with "No packages selected" when selection returns empty', async () => {
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No packages selected'))
    expect(mocks.upgradePackages).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('exits with "Upgrade cancelled" when user declines confirmation', async () => {
    mocks.selectPackagesToUpgradeProgressive.mockResolvedValue([{
      name: 'next', packageJsonPath: '/repo/package.json', dependencyType: 'dependencies',
      upgradeType: 'range', targetVersion: '^1.1.0', currentVersionSpecifier: '^1.0.0',
    }])
    mocks.confirmUpgrade.mockResolvedValue(false)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new UpgradeRunner({ cwd: '/repo' }).run()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Upgrade cancelled'))
    expect(mocks.upgradePackages).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('calls upgradePackages when user confirms', async () => {
    const choice = {
      name: 'next', packageJsonPath: '/repo/package.json', dependencyType: 'dependencies',
      upgradeType: 'range', targetVersion: '^1.1.0', currentVersionSpecifier: '^1.0.0',
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

    mocks.selectPackagesToUpgradeProgressive
      .mockResolvedValueOnce(selectedChoices)
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
