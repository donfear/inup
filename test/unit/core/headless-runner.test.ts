import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOutdatedPackages: vi.fn(),
  getOutdatedPackagesOnly: vi.fn(),
  hasPackageJson: vi.fn(),
  detectPackageManager: vi.fn(),
}))

vi.mock('../../../src/core/package-detector', () => ({
  PackageDetector: class {
    getOutdatedPackages = mocks.getOutdatedPackages
    getOutdatedPackagesOnly = mocks.getOutdatedPackagesOnly
    hasPackageJson = mocks.hasPackageJson
  },
}))

vi.mock('../../../src/interactive-ui', () => ({
  InteractiveUI: class {},
}))

vi.mock('../../../src/core/upgrader', () => ({
  PackageUpgrader: class {},
}))

vi.mock('../../../src/services/package-manager-detector', () => ({
  PackageManagerDetector: {
    detect: mocks.detectPackageManager,
    getInfo: mocks.detectPackageManager,
  },
}))

import { UpgradeRunner } from '../../../src/core/upgrade-runner'

const OUTDATED = {
  name: 'axios',
  currentVersion: '^0.27.0',
  rangeVersion: '0.27.2',
  latestVersion: '1.16.1',
  type: 'dependencies',
  packageJsonPath: '/repo/package.json',
  isOutdated: true,
  hasRangeUpdate: true,
  hasMajorUpdate: true,
  deprecated: 'use the platform fetch instead',
  enginesNode: '>=14',
}

const UP_TO_DATE = {
  name: 'left-pad',
  currentVersion: '^1.3.0',
  rangeVersion: '1.3.0',
  latestVersion: '1.3.0',
  type: 'dependencies',
  packageJsonPath: '/repo/package.json',
  isOutdated: false,
  hasRangeUpdate: false,
  hasMajorUpdate: false,
}

describe('UpgradeRunner.runHeadless', () => {
  const originalExitCode = process.exitCode

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasPackageJson.mockReturnValue(true)
    mocks.detectPackageManager.mockReturnValue({
      name: 'npm',
      displayName: 'npm',
      lockFile: 'package-lock.json',
      workspaceFile: null,
      installCommand: 'npm install',
      color: null,
    })
    // Real-ish filter so the report's "total vs outdated" split is exercised.
    mocks.getOutdatedPackagesOnly.mockImplementation((pkgs: any[]) =>
      pkgs.filter((p) => p.isOutdated)
    )
    mocks.getOutdatedPackages.mockResolvedValue([OUTDATED, UP_TO_DATE])
  })

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  it('--json prints a single, valid JSON document with the documented shape', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await new UpgradeRunner({ cwd: '/repo' }).runHeadless({ json: true })

    // stdout carries the JSON and nothing else.
    expect(logSpy).toHaveBeenCalledTimes(1)
    const report = JSON.parse(logSpy.mock.calls[0][0] as string)

    expect(report.summary).toEqual({ total: 2, outdated: 1, major: 1 })
    expect(report.outdated).toHaveLength(1)
    expect(report.outdated[0]).toMatchObject({
      name: 'axios',
      current: '^0.27.0',
      range: '0.27.2',
      latest: '1.16.1',
      type: 'dependencies',
      packageJsonPath: '/repo/package.json',
      hasMajorUpdate: true,
      deprecated: 'use the platform fetch instead',
      enginesNode: '>=14',
    })
    // Optional fields are omitted when absent, not emitted as null/undefined.
    expect('vulnerability' in report.outdated[0]).toBe(false)

    logSpy.mockRestore()
  })

  it('--check sets a non-zero exit code when updates exist', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.exitCode = 0

    await new UpgradeRunner({ cwd: '/repo' }).runHeadless({ check: true })

    expect(process.exitCode).toBe(1)
    logSpy.mockRestore()
  })

  it('--check leaves the exit code at 0 when everything is up to date', async () => {
    mocks.getOutdatedPackages.mockResolvedValue([UP_TO_DATE])
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.exitCode = 0

    await new UpgradeRunner({ cwd: '/repo' }).runHeadless({ check: true })

    expect(process.exitCode).toBe(0)
    logSpy.mockRestore()
  })

  it('with no flags prints a plain line-based report and recap, no exit code', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.exitCode = 0

    await new UpgradeRunner({ cwd: '/repo' }).runHeadless({})

    const lines = logSpy.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.includes('axios') && l.includes('→'))).toBe(true)
    expect(lines.some((l) => /outdated across 1 file/.test(l))).toBe(true)
    expect(process.exitCode).toBe(0)
    logSpy.mockRestore()
  })

  it('exits 2 on error (no package.json)', async () => {
    mocks.hasPackageJson.mockReturnValue(false)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await new UpgradeRunner({ cwd: '/no-pkg' }).runHeadless({ json: true })

    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No package.json'))
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
