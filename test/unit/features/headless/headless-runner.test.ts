import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  scanResult: vi.fn(),
  getCooldownDiagnostics: vi.fn(() => null),
  streamOutdatedPackages: vi.fn(),
  getOutdatedPackagesOnly: vi.fn(),
  hasPackageJson: vi.fn(),
  fetchVulnerabilities: vi.fn(),
  upgradePackages: vi.fn(),
  upgraderCtor: vi.fn(),
}))

vi.mock('../../../../src/features/upgrade/package-detector', () => ({
  PackageDetector: class {
    streamOutdatedPackages = mocks.streamOutdatedPackages
    getOutdatedPackagesOnly = mocks.getOutdatedPackagesOnly
    hasPackageJson = mocks.hasPackageJson
    getCooldownDiagnostics = mocks.getCooldownDiagnostics
  },
}))

vi.mock('../../../../src/features/upgrade/upgrader', () => ({
  PackageUpgrader: class {
    constructor(...args: unknown[]) {
      mocks.upgraderCtor(...args)
    }
    upgradePackages = mocks.upgradePackages
  },
}))

vi.mock('../../../../src/shared/package-manager', () => ({
  PackageManagerDetector: {
    resolve: vi.fn((options?: { packageManager?: string }) => {
      const name = options?.packageManager ?? 'npm'
      return { name, displayName: name }
    }),
  },
}))

vi.mock('../../../../src/features/audit/vulnerability-checker', () => ({
  fetchVulnerabilities: mocks.fetchVulnerabilities,
}))

import { HeadlessRunner } from '../../../../src/features/headless'
import { getVisualLength } from '../../../../src/shared/terminal'
import type {
  PackageLoadProgress,
  StreamOutdatedPackagesCallback,
} from '../../../../src/shared/types'

const OUTDATED = {
  name: 'axios',
  currentVersion: '^0.27.0',
  rangeVersion: '0.27.2',
  latestVersion: '1.16.1',
  allVersions: ['0.27.0', '0.27.1', '0.27.2', '1.0.0', '1.16.1'],
  type: 'dependencies',
  packageJsonPath: '/repo/package.json',
  isOutdated: true,
  hasRangeUpdate: true,
  hasMajorUpdate: true,
}

// The in-range bump crosses a minor boundary (no newer patch in 2.0.x). `--target patch` must
// skip this package; `--target minor` takes it.
const MINOR_ONLY = {
  name: 'lodash-ish',
  currentVersion: '~2.0.0',
  rangeVersion: '2.3.0',
  latestVersion: '2.3.0',
  allVersions: ['2.0.0', '2.1.0', '2.3.0'],
  type: 'dependencies',
  packageJsonPath: '/repo/package.json',
  isOutdated: true,
  hasRangeUpdate: true,
  hasMajorUpdate: false,
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

// A prerelease install with a newer same-tuple prerelease available. The
// detector produced the candidate pool (stable + same-tuple prereleases) and
// an effective latest on the prerelease channel.
const PRERELEASE = {
  name: 'vuetify-nuxt-module',
  currentVersion: '^1.0.0-beta.2',
  rangeVersion: '1.0.0-rc.3',
  latestVersion: '1.0.0-rc.3',
  allVersions: ['1.0.0-rc.3', '1.0.0-rc.1', '1.0.0-beta.2', '0.19.5'],
  type: 'dependencies',
  packageJsonPath: '/repo/package.json',
  isOutdated: true,
  hasRangeUpdate: true,
  hasMajorUpdate: false,
}

// Only a major bump is available — no in-range update. `--target minor` must skip this entirely.
const MAJOR_ONLY = {
  name: 'chalk',
  currentVersion: '^4.1.2',
  rangeVersion: '4.1.2',
  latestVersion: '5.6.2',
  type: 'devDependencies',
  packageJsonPath: '/repo/package.json',
  isOutdated: true,
  hasRangeUpdate: false,
  hasMajorUpdate: true,
}

// A library declaring the same package twice: a runtime dependency, and the peer range it
// advertises to its host. Bumping the peer floor would silently drop support for every older
// host version, so `--apply` must write the dependency and leave the peer range alone.
const LODASH_DEP = {
  name: 'lodash',
  currentVersion: '^4.0.0',
  rangeVersion: '4.18.1',
  latestVersion: '5.0.0',
  allVersions: ['4.0.0', '4.0.1', '4.18.1', '5.0.0'],
  type: 'dependencies',
  packageJsonPath: '/repo/package.json',
  isOutdated: true,
  hasRangeUpdate: true,
  hasMajorUpdate: true,
}

const LODASH_PEER = { ...LODASH_DEP, type: 'peerDependencies' }

describe('HeadlessRunner.run', () => {
  const originalExitCode = process.exitCode

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasPackageJson.mockReturnValue(true)
    mocks.getOutdatedPackagesOnly.mockImplementation((pkgs: any[]) =>
      pkgs.filter((p) => p.isOutdated)
    )
    mocks.scanResult.mockResolvedValue([OUTDATED, UP_TO_DATE])
    // The streaming form the runner uses: an `initial` event carrying every
    // declared dependency's specifier, then `complete` with the resolved set.
    mocks.streamOutdatedPackages.mockImplementation(async (onEvent: (e: unknown) => void) => {
      const packages = await mocks.scanResult()
      onEvent({
        type: 'initial',
        payload: {
          currentVersions: new Map(packages.map((p: any) => [p.name, p.currentVersion])),
          declaredVersions: packages.map((p: any) => ({ name: p.name, version: p.currentVersion })),
          progress: {},
        },
      })
      onEvent({ type: 'complete', payload: { packages, progress: {} } })
      return packages
    })
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
    expect(report.schemaVersion).toBe(2)
    expect(report.summary).toEqual({
      total: 2,
      outdated: 1,
      major: 1,
      vulnerable: 0,
      heldByCooldown: 0,
      failed: 0,
    })
    expect(report.outdated).toHaveLength(1)
    expect(report.outdated[0].name).toBe('axios')
    expect('vulnerability' in report.outdated[0]).toBe(false)

    logSpy.mockRestore()
  })

  it.each([true, false])('renders ordered scan status only on a TTY (%s)', async (isTTY) => {
    vi.stubEnv('CI', '')
    const tty = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY')
    const columns = Object.getOwnPropertyDescriptor(process.stderr, 'columns')
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: isTTY })
    Object.defineProperty(process.stderr, 'columns', { configurable: true, value: 60 })
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.streamOutdatedPackages.mockImplementation(
      async (onEvent: StreamOutdatedPackagesCallback) => {
        const status = (
          phase: PackageLoadProgress['phase'],
          detail: Partial<PackageLoadProgress> = {}
        ) =>
          onEvent({
            type: 'status',
            payload: {
              progress: {
                phase,
                resolved: 0,
                failed: 0,
                total: 0,
                isLoading: phase !== 'done',
                ...detail,
              },
            },
          })
        status('discovering')
        status('discovering', { scanningDir: '/repo/packages/api', packageJsonFiles: 1 })
        status('collecting', { packageJsonFiles: 1 })
        status('collecting', { packageJsonFiles: 2 })
        status('resolving')
        status('discovering', { scanningDir: `/repo/${'日本語/'.repeat(30)}`, packageJsonFiles: 3 })
        status('done')
        onEvent({ type: 'warning', payload: { message: 'Skipped directory' } })
        onEvent({
          type: 'complete',
          payload: {
            packages: [],
            progress: {
              phase: 'done',
              resolved: 0,
              failed: 0,
              total: 0,
              isLoading: false,
            },
          },
        })
        return []
      }
    )
    try {
      await new HeadlessRunner({ cwd: '/repo' }).run({ json: true })
      expect(warn).toHaveBeenCalledWith('Skipped directory')
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])).schemaVersion).toBe(2)
      const messages = write.mock.calls.map(([chunk]) => String(chunk).split('\r').at(-1)!)
      if (isTTY) {
        expect(messages.slice(0, 7)).toEqual([
          'Scanning repository for package.json files…',
          'Scanning /repo/packages/api (found 1)',
          'Found 1 package.json file',
          'Reading dependencies…',
          'Found 2 package.json files',
          'Reading dependencies…',
          'Identifying unique packages…',
        ])
        expect(messages.every((message) => getVisualLength(message) <= 60)).toBe(true)
        expect(messages.at(-1)).toBe('')
        // The warning starts on a cleared line, not after the progress text.
        const warnedAt = warn.mock.invocationCallOrder[0]
        const writesBeforeWarning = write.mock.invocationCallOrder.filter((at) => at < warnedAt)
        expect(messages[writesBeforeWarning.length - 1]).toBe('')
      } else {
        expect(write).not.toHaveBeenCalled()
      }
    } finally {
      if (tty) Object.defineProperty(process.stderr, 'isTTY', tty)
      else delete process.stderr.isTTY
      if (columns) Object.defineProperty(process.stderr, 'columns', columns)
      else delete process.stderr.columns
      write.mockRestore()
      log.mockRestore()
      warn.mockRestore()
      vi.unstubAllEnvs()
    }
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

    // The audit checks the currently-installed specifier of every declared
    // dependency (it starts before the registry says which are outdated), and
    // stays best-effort: no rejection is asked for.
    expect(mocks.fetchVulnerabilities).toHaveBeenCalledWith(
      new Map([
        ['axios', '^0.27.0'],
        ['left-pad', '^1.3.0'],
      ]),
      {}
    )

    const report = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(report.summary.vulnerable).toBe(1)
    expect(report.outdated[0].vulnerability).toMatchObject({
      count: 1,
      highestSeverity: 'high',
      fixedByRange: false,
      fixedByLatest: true,
      advisories: [
        { id: 1, vulnerableVersions: '<1.0.0', fixedByRange: false, fixedByLatest: true },
      ],
    })

    logSpy.mockRestore()
  })

  it('starts the advisory request from the initial dependency set, before packages resolve', async () => {
    let auditCallsBeforeComplete = -1
    mocks.streamOutdatedPackages.mockImplementation(async (onEvent: (e: unknown) => void) => {
      onEvent({
        type: 'initial',
        payload: {
          currentVersions: new Map([
            ['axios', '^0.27.0'],
            ['left-pad', '^1.3.0'],
          ]),
          declaredVersions: [
            { name: 'axios', version: '^0.27.0' },
            { name: 'left-pad', version: '^1.3.0' },
          ],
          progress: {},
        },
      })
      // Registry still "in flight" here: the bulk audit must already be on its way.
      auditCallsBeforeComplete = mocks.fetchVulnerabilities.mock.calls.length
      onEvent({ type: 'complete', payload: { packages: [OUTDATED, UP_TO_DATE], progress: {} } })
      return [OUTDATED, UP_TO_DATE]
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await new HeadlessRunner({ cwd: '/repo' }).run({ json: true })

    expect(auditCallsBeforeComplete).toBe(1)
    expect(mocks.fetchVulnerabilities).toHaveBeenCalledTimes(1)
    const report = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(report.outdated.map((p: any) => p.name)).toEqual(['axios'])
    logSpy.mockRestore()
  })

  it('warns on stderr and flags the report when the cooldown could not act', async () => {
    // An inert cooldown must never read as a satisfied one — this is the path CI gates on.
    mocks.getCooldownDiagnostics.mockReturnValue({
      minimumReleaseAge: 10080,
      publishTimesAvailable: false,
    })
    mocks.scanResult.mockResolvedValue([])
    mocks.getOutdatedPackagesOnly.mockReturnValue([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await new HeadlessRunner({ cwd: '/repo' }).run({ json: true })

    const report = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(report.cooldown).toEqual({ minimumReleaseAge: 10080, publishTimesAvailable: false })
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('--minimum-release-age 10080 had no effect')
    )

    logSpy.mockRestore()
    errSpy.mockRestore()
  })

  it('stays quiet and omits the cooldown block when no cooldown is configured', async () => {
    mocks.getCooldownDiagnostics.mockReturnValue(null)
    mocks.scanResult.mockResolvedValue([])
    mocks.getOutdatedPackagesOnly.mockReturnValue([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await new HeadlessRunner({ cwd: '/repo' }).run({ json: true })

    const report = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(report).not.toHaveProperty('cooldown')
    expect(errSpy).not.toHaveBeenCalled()

    logSpy.mockRestore()
    errSpy.mockRestore()
  })

  it('--check sets exit code 1 when updates exist, 0 when up to date', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    process.exitCode = 0
    await new HeadlessRunner({ cwd: '/repo' }).run({ check: true })
    expect(process.exitCode).toBe(1)

    mocks.scanResult.mockResolvedValue([UP_TO_DATE])
    process.exitCode = 0
    await new HeadlessRunner({ cwd: '/repo' }).run({ check: true })
    expect(process.exitCode).toBe(0)

    logSpy.mockRestore()
  })

  it('warns about failed lookups on stderr, naming the first five, without --check', async () => {
    const failedLookup = (name: string) => ({
      ...UP_TO_DATE,
      name,
      rangeVersion: 'unknown',
      latestVersion: 'unknown',
      lookupFailed: true,
    })
    mocks.scanResult.mockResolvedValue([
      OUTDATED,
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(failedLookup),
      // A second location of the same package is still one failed lookup.
      { ...failedLookup('a'), packageJsonPath: '/repo/apps/web/package.json' },
    ])
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.exitCode = 0

    await new HeadlessRunner({ cwd: '/repo' }).run({})

    expect(errSpy).toHaveBeenCalledWith(
      'Warning: 7 package(s) could not be checked — the registry lookup failed: a, b, c, d, e (+2 more)'
    )
    expect(process.exitCode).toBe(0)
    logSpy.mockRestore()
    errSpy.mockRestore()
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

  describe('--apply', () => {
    it('target=minor bumps in-range and skips major-only packages', async () => {
      mocks.scanResult.mockResolvedValue([OUTDATED, MAJOR_ONLY, UP_TO_DATE])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'minor' })

      expect(mocks.upgradePackages).toHaveBeenCalledTimes(1)
      const choices = mocks.upgradePackages.mock.calls[0][0]
      // axios has an in-range bump; chalk is major-only and must be skipped.
      expect(choices).toHaveLength(1)
      expect(choices[0]).toMatchObject({
        name: 'axios',
        upgradeType: 'range',
        targetVersion: '^0.27.2', // range target with the original ^ prefix preserved
        dependencyType: 'dependencies',
        packageJsonPath: '/repo/package.json',
      })
      logSpy.mockRestore()
    })

    it('target=patch bumps only within the current major.minor line', async () => {
      mocks.scanResult.mockResolvedValue([OUTDATED, MINOR_ONLY, MAJOR_ONLY, UP_TO_DATE])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'patch' })

      const choices = mocks.upgradePackages.mock.calls[0][0]
      // axios has newer 0.27.x patches; lodash-ish only has minor bumps and chalk only a major —
      // both must be skipped even though they have in-range updates.
      expect(choices).toHaveLength(1)
      expect(choices[0]).toMatchObject({
        name: 'axios',
        upgradeType: 'range',
        targetVersion: '^0.27.2',
      })
      logSpy.mockRestore()
    })

    it('exits 2 when the install fails, so CI never goes green on a stale lockfile', async () => {
      mocks.upgradePackages.mockRejectedValueOnce(new Error('Run `npm install` in:\n  /repo'))
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, json: true })

      expect(exitSpy).toHaveBeenCalledWith(2)
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Run `npm install` in'))
      expect(logSpy).not.toHaveBeenCalled()
      exitSpy.mockRestore()
      logSpy.mockRestore()
      errorSpy.mockRestore()
    })

    it('target=patch skips packages without version-list data', async () => {
      const { allVersions: _omitted, ...withoutVersions } = OUTDATED
      mocks.scanResult.mockResolvedValue([withoutVersions])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'patch' })

      expect(mocks.upgradePackages).not.toHaveBeenCalled()
      logSpy.mockRestore()
    })

    it('target=latest skips packages whose latest version is empty', async () => {
      mocks.scanResult.mockResolvedValue([{ ...OUTDATED, latestVersion: '' }])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'latest' })

      expect(mocks.upgradePackages).not.toHaveBeenCalled()
      logSpy.mockRestore()
    })

    it('target=latest bumps to latest including majors', async () => {
      mocks.scanResult.mockResolvedValue([OUTDATED, MAJOR_ONLY, UP_TO_DATE])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'latest' })

      const choices = mocks.upgradePackages.mock.calls[0][0]
      expect(choices).toHaveLength(2)
      const byName = Object.fromEntries(choices.map((c: any) => [c.name, c]))
      expect(byName.axios).toMatchObject({ upgradeType: 'latest', targetVersion: '^1.16.1' })
      expect(byName.chalk).toMatchObject({ upgradeType: 'latest', targetVersion: '^5.6.2' })
      logSpy.mockRestore()
    })

    it('never applies a version the cooldown withheld, at any target', async () => {
      // End of the chain: the gate happens in the detector, so `--apply` can only ever
      // choose from what survived it. This pins that the withheld version has no path
      // back in through latestVersion or the version list.
      const held = {
        ...OUTDATED,
        latestVersion: '1.0.0', // 1.16.1 was withheld; the effective latest is older
        allVersions: ['0.27.0', '0.27.1', '0.27.2', '1.0.0'],
        heldByCooldown: {
          version: '1.16.1',
          publishedAt: '2026-09-17T00:00:00.000Z',
          ageMinutes: 30,
          count: 1,
        },
      }
      mocks.scanResult.mockResolvedValue([held])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      for (const target of ['minor', 'patch', 'latest'] as const) {
        mocks.upgradePackages.mockClear()
        await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target })

        const choices = mocks.upgradePackages.mock.calls[0]?.[0] ?? []
        for (const choice of choices) {
          expect(choice.targetVersion, `target=${target}`).not.toContain('1.16.1')
        }
      }

      logSpy.mockRestore()
    })

    it('--apply --json still reports what the cooldown withheld', async () => {
      // The upgrade happened; the hold is still the thing a reviewer needs to see.
      const held = {
        ...OUTDATED,
        latestVersion: '1.0.0',
        allVersions: ['0.27.0', '0.27.1', '0.27.2', '1.0.0'],
        heldByCooldown: {
          version: '1.16.1',
          publishedAt: '2026-09-17T00:00:00.000Z',
          ageMinutes: 30,
          count: 1,
        },
      }
      mocks.scanResult.mockResolvedValue([held])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, json: true, target: 'latest' })

      const report = JSON.parse(logSpy.mock.calls[0][0] as string)
      expect(report.summary.heldByCooldown).toBe(1)
      expect(report.heldByCooldown).toEqual([
        expect.objectContaining({ name: 'axios', version: '1.16.1', count: 1 }),
      ])
      expect(report.outdated[0].heldByCooldown).toMatchObject({ version: '1.16.1' })
      logSpy.mockRestore()
    })

    it('target=latest holds ignoreMajor packages to their in-range bump', async () => {
      // Detector-level suppression already cleared hasMajorUpdate and set
      // majorIgnored; latest must not resurrect the major via latestVersion.
      const majorIgnored = {
        ...OUTDATED,
        name: '@tiptap/core',
        hasMajorUpdate: false,
        majorIgnored: true,
      }
      mocks.scanResult.mockResolvedValue([majorIgnored])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'latest' })

      const choices = mocks.upgradePackages.mock.calls[0][0]
      expect(choices).toHaveLength(1)
      expect(choices[0]).toMatchObject({ name: '@tiptap/core', targetVersion: '^0.27.2' })
      logSpy.mockRestore()
    })

    it('target=latest skips ignoreMajor packages without an in-range bump', async () => {
      // Normally the detector already drops these from the outdated set
      // (isOutdated=false); keep them outdated here to pin the defensive
      // branch in resolveTargetVersion itself.
      const suppressedMajorOnly = {
        ...MAJOR_ONLY,
        hasMajorUpdate: false,
        majorIgnored: true,
      }
      const suppressedEmptyRange = {
        ...OUTDATED,
        name: 'no-range-data',
        rangeVersion: '',
        hasMajorUpdate: false,
        majorIgnored: true,
      }
      mocks.scanResult.mockResolvedValue([suppressedMajorOnly, suppressedEmptyRange])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'latest' })

      expect(mocks.upgradePackages).not.toHaveBeenCalled()
      logSpy.mockRestore()
    })

    it('--save-exact writes bare versions without the range prefix', async () => {
      mocks.scanResult.mockResolvedValue([OUTDATED])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo', saveExact: true }).run({
        apply: true,
        target: 'minor',
      })

      const choices = mocks.upgradePackages.mock.calls[0][0]
      expect(choices[0].targetVersion).toBe('0.27.2')
      logSpy.mockRestore()
    })

    it.each(['minor', 'patch', 'latest'] as const)(
      'target=%s bumps the dependency and never rewrites the peer range',
      async (target) => {
        mocks.scanResult.mockResolvedValue([LODASH_DEP, LODASH_PEER])
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target })

        const choices = mocks.upgradePackages.mock.calls[0][0]
        expect(choices).toEqual([
          expect.objectContaining({ name: 'lodash', dependencyType: 'dependencies' }),
        ])
        logSpy.mockRestore()
      }
    )

    it('does not call the upgrader when only peer ranges are outdated, but still reports them', async () => {
      mocks.scanResult.mockResolvedValue([LODASH_PEER])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'latest', json: true })

      expect(mocks.upgradePackages).not.toHaveBeenCalled()
      const report = JSON.parse(logSpy.mock.calls[0][0] as string)
      expect(report.outdated).toEqual([
        expect.objectContaining({ name: 'lodash', type: 'peerDependencies' }),
      ])
      logSpy.mockRestore()
    })

    it('does not call the upgrader when nothing is in-range to apply', async () => {
      mocks.scanResult.mockResolvedValue([MAJOR_ONLY, UP_TO_DATE])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'minor' })

      expect(mocks.upgradePackages).not.toHaveBeenCalled()
      logSpy.mockRestore()
    })

    it('--apply --json emits exactly one JSON document and runs the upgrader in quiet mode', async () => {
      mocks.scanResult.mockResolvedValue([OUTDATED])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'minor', json: true })

      // stdout (console.log) carries exactly the JSON document — no progress lines.
      expect(logSpy).toHaveBeenCalledTimes(1)
      const report = JSON.parse(logSpy.mock.calls[0][0] as string)
      expect(report.summary).toMatchObject({ outdated: 1 })

      // The upgrader is constructed with quiet:true so it keeps stdout clean (own logs + install
      // child's stdout go to stderr). This is the contract that protects the --json document.
      expect(mocks.upgraderCtor).toHaveBeenCalledWith(expect.anything(), { quiet: true })

      logSpy.mockRestore()
    })

    it('--apply without --json runs the upgrader in non-quiet mode', async () => {
      mocks.scanResult.mockResolvedValue([OUTDATED])

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'minor' })

      expect(mocks.upgraderCtor).toHaveBeenCalledWith(expect.anything(), { quiet: false })
    })

    it('defaults to target=minor when --apply is given without a target', async () => {
      mocks.scanResult.mockResolvedValue([OUTDATED, MAJOR_ONLY])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true })

      const choices = mocks.upgradePackages.mock.calls[0][0]
      expect(choices).toHaveLength(1)
      expect(choices[0]).toMatchObject({ name: 'axios', upgradeType: 'range' })
      logSpy.mockRestore()
    })

    it('skips packages whose target version is empty', async () => {
      mocks.scanResult.mockResolvedValue([{ ...OUTDATED, rangeVersion: '' }, UP_TO_DATE])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'minor' })

      expect(mocks.upgradePackages).not.toHaveBeenCalled()
      logSpy.mockRestore()
    })

    it('target=minor writes a prerelease bump with the original prefix preserved', async () => {
      mocks.scanResult.mockResolvedValue([PRERELEASE, UP_TO_DATE])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'minor' })

      const choices = mocks.upgradePackages.mock.calls[0][0]
      expect(choices).toHaveLength(1)
      expect(choices[0]).toMatchObject({
        name: 'vuetify-nuxt-module',
        upgradeType: 'range',
        targetVersion: '^1.0.0-rc.3',
      })
      logSpy.mockRestore()
    })

    it('target=patch resolves the highest same-tuple prerelease from the pool', async () => {
      mocks.scanResult.mockResolvedValue([PRERELEASE])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'patch' })

      const choices = mocks.upgradePackages.mock.calls[0][0]
      expect(choices).toHaveLength(1)
      expect(choices[0].targetVersion).toBe('^1.0.0-rc.3')
      logSpy.mockRestore()
    })

    it('target=latest takes the effective latest on the prerelease channel', async () => {
      mocks.scanResult.mockResolvedValue([PRERELEASE])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo' }).run({ apply: true, target: 'latest' })

      const choices = mocks.upgradePackages.mock.calls[0][0]
      expect(choices[0]).toMatchObject({
        upgradeType: 'latest',
        targetVersion: '^1.0.0-rc.3',
      })
      logSpy.mockRestore()
    })

    it('--save-exact writes the bare prerelease version', async () => {
      mocks.scanResult.mockResolvedValue([PRERELEASE])
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await new HeadlessRunner({ cwd: '/repo', saveExact: true }).run({
        apply: true,
        target: 'minor',
      })

      const choices = mocks.upgradePackages.mock.calls[0][0]
      expect(choices[0].targetVersion).toBe('1.0.0-rc.3')
      logSpy.mockRestore()
    })
  })

  it('plain report shows a prerelease bump without the (major) tag', async () => {
    mocks.scanResult.mockResolvedValue([PRERELEASE])
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await new HeadlessRunner({ cwd: '/repo' }).run({})

    const output = String(logSpy.mock.calls[0][0])
    expect(output).toContain('vuetify-nuxt-module')
    expect(output).toContain('1.0.0-rc.3')
    expect(output).not.toContain('(major)')
    logSpy.mockRestore()
  })

  it('stringifies non-Error failures before exiting', async () => {
    mocks.scanResult.mockRejectedValue('string failure')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await new HeadlessRunner({ cwd: '/repo' }).run({ json: true })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('string failure'))
    expect(exitSpy).toHaveBeenCalledWith(2)
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('resolves the package manager from its options when applying', async () => {
    // The package manager is only resolved when --apply hands work to the upgrader.
    const { PackageManagerDetector } = await import('../../../../src/shared/package-manager')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await new HeadlessRunner({ packageManager: 'pnpm' }).run({ apply: true })
    expect(vi.mocked(PackageManagerDetector.resolve)).toHaveBeenCalledWith({
      packageManager: 'pnpm',
    })
    logSpy.mockRestore()
  })
})
