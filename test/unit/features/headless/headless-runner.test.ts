import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOutdatedPackages: vi.fn(),
  getOutdatedPackagesOnly: vi.fn(),
  hasPackageJson: vi.fn(),
  fetchVulnerabilities: vi.fn(),
}))

vi.mock('../../../../src/core/package-detector', () => ({
  PackageDetector: class {
    getOutdatedPackages = mocks.getOutdatedPackages
    getOutdatedPackagesOnly = mocks.getOutdatedPackagesOnly
    hasPackageJson = mocks.hasPackageJson
    getPerfConfig = vi.fn().mockReturnValue({
      cwd: '/repo',
      adaptive: false,
      maxConcurrency: 8,
      batchSize: 10,
      poolConnections: 5,
    })
  },
}))

vi.mock('../../../../src/services', () => ({
  fetchVulnerabilities: mocks.fetchVulnerabilities,
}))

import { HeadlessRunner } from '../../../../src/features/headless'

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

describe('HeadlessRunner.run', () => {
  const originalExitCode = process.exitCode

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasPackageJson.mockReturnValue(true)
    mocks.getOutdatedPackagesOnly.mockImplementation((pkgs: any[]) =>
      pkgs.filter((p) => p.isOutdated)
    )
    mocks.getOutdatedPackages.mockResolvedValue([OUTDATED, UP_TO_DATE])
    mocks.fetchVulnerabilities.mockResolvedValue(new Map())
  })

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  it('--json prints one valid JSON document with schemaVersion and summary', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await new HeadlessRunner({ cwd: '/repo' }).run({ json: true })

    expect(logSpy).toHaveBeenCalledTimes(1)
    const report = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(report.schemaVersion).toBe(1)
    expect(report.summary).toEqual({ total: 2, outdated: 1, major: 1, vulnerable: 0 })
    expect(report.outdated).toHaveLength(1)
    expect(report.outdated[0].name).toBe('axios')
    expect('vulnerability' in report.outdated[0]).toBe(false)

    logSpy.mockRestore()
  })

  it('--json cross-references advisories against the upgrade targets', async () => {
    // Advisory A (<1.0.0): latest (1.16.1) escapes it, the in-range bump (0.27.2) does not.
    mocks.fetchVulnerabilities.mockResolvedValue(
      new Map([
        [
          'axios',
          {
            packageName: 'axios',
            highestSeverity: 'high',
            vulnerabilities: [
              {
                id: 1,
                title: 'SSRF',
                severity: 'high',
                url: 'https://github.com/advisories/GHSA-a',
                vulnerable_versions: '<1.0.0',
              },
            ],
          },
        ],
      ])
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await new HeadlessRunner({ cwd: '/repo' }).run({ json: true })

    // The audit checks the currently-installed specifier.
    expect(mocks.fetchVulnerabilities).toHaveBeenCalledWith(new Map([['axios', '^0.27.0']]))

    const report = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(report.summary.vulnerable).toBe(1)
    expect(report.outdated[0].vulnerability).toMatchObject({
      count: 1,
      highestSeverity: 'high',
      fixedByRange: false,
      fixedByLatest: true,
      advisories: [{ id: 1, vulnerableVersions: '<1.0.0', fixedByRange: false, fixedByLatest: true }],
    })

    logSpy.mockRestore()
  })

  it('--check sets exit code 1 when updates exist, 0 when up to date', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    process.exitCode = 0
    await new HeadlessRunner({ cwd: '/repo' }).run({ check: true })
    expect(process.exitCode).toBe(1)

    mocks.getOutdatedPackages.mockResolvedValue([UP_TO_DATE])
    process.exitCode = 0
    await new HeadlessRunner({ cwd: '/repo' }).run({ check: true })
    expect(process.exitCode).toBe(0)

    logSpy.mockRestore()
  })

  it('with no flags prints a plain report and leaves the exit code untouched', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.exitCode = 0

    await new HeadlessRunner({ cwd: '/repo' }).run({})

    const output = String(logSpy.mock.calls[0][0])
    expect(output).toContain('axios')
    expect(output).toMatch(/outdated across 1 file/)
    expect(process.exitCode).toBe(0)
    logSpy.mockRestore()
  })

  it('exits 2 on error (no package.json)', async () => {
    mocks.hasPackageJson.mockReturnValue(false)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await new HeadlessRunner({ cwd: '/no-pkg' }).run({ json: true })

    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No package.json'))
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
