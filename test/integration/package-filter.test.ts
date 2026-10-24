import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackageInfo, PackageLoadProgress, PackageUpgradeChoice } from '../../src/shared/types'

/**
 * `inup <packages…>` end to end: the real CLI, `.inuprc` loading, `PackageDetector` scan and
 * `PackageUpgrader` write, over a temp project. Only the registry, the audit, child processes,
 * the update check and the picker's screen are stubbed, so what is filtered, reported and written
 * is decided by the real code.
 */

const mocks = vi.hoisted(() => ({
  fetchPackageVersions: vi.fn(),
  fetchVulnerabilities: vi.fn(),
  spawnSync: vi.fn(),
  pickerRows: [] as PackageInfo[],
}))

// Registry: every package's latest is 2.0.0, with a 1.x line in range.
vi.mock('../../src/shared/registry/npm-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/registry/npm-registry')>()
  const { collectedFetch } = await import('../helpers/registry-fetch')
  return { ...actual, startPackageVersionFetch: collectedFetch(mocks.fetchPackageVersions) }
})

vi.mock('../../src/features/audit/vulnerability-checker', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/features/audit/vulnerability-checker')>()
  return { ...actual, fetchVulnerabilities: mocks.fetchVulnerabilities }
})

// Installs and `npm ls -g` succeed without running anything.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, spawnSync: mocks.spawnSync }
})

vi.mock('../../src/shared/registry/version-checker', () => ({
  checkForUpdateAsync: vi.fn(async () => null),
}))

// The picker's screen: it records the rows the scan gives it, then picks the latest version of
// each once loading is done, the way `l` and Enter would.
vi.mock('../../src/app/interactive-ui', () => ({
  InteractiveUI: class {
    prefetchSecurityAudit() {}
    setCooldownHeldCount() {}
    setCooldownUnsupported() {}
    insertResolvedPackages(_selection: unknown, packages: PackageInfo[]) {
      mocks.pickerRows.push(...packages)
    }
    async selectPackagesToUpgradeProgressive(
      _selection: unknown,
      progress: PackageLoadProgress
    ): Promise<PackageUpgradeChoice[]> {
      while (progress.isLoading) await new Promise((resolve) => setTimeout(resolve, 5))
      return mocks.pickerRows.map((pkg) => ({
        name: pkg.name,
        packageJsonPath: pkg.packageJsonPath,
        dependencyType: pkg.type,
        upgradeType: 'latest',
        targetVersion: '^2.0.0',
        currentVersionSpecifier: pkg.currentVersion,
      }))
    }
    async confirmUpgrade() {
      return true
    }
  },
}))

import { runCli } from '../../src/cli'

let projectDir: string

function cliOptions(packages: string[], overrides: Record<string, unknown> = {}) {
  return {
    dir: projectDir,
    exclude: '',
    ignore: undefined,
    maxDepth: '10',
    native: false,
    packages,
    ...overrides,
  } as any
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf-8'))

/** Every package name the registry was asked about. */
const requested = () => mocks.fetchPackageVersions.mock.calls.flatMap(([names]) => names).sort()

const DEPENDENCIES = {
  react: '^1.0.0',
  'react-dom': '^1.0.0',
  'eslint-plugin-x': '^1.0.0',
  'left-pad': '^1.0.0',
  zod: '^2.0.0', // already on the latest version
}

describe('inup <packages…>', () => {
  let log: ReturnType<typeof vi.spyOn>
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pickerRows.length = 0
    mocks.fetchVulnerabilities.mockResolvedValue(new Map())
    mocks.spawnSync.mockReturnValue({ status: 0, signal: null })
    mocks.fetchPackageVersions.mockImplementation(
      async (names: string[], opts: { onPackageReady?: (result: unknown) => void }) => {
        for (const name of names) {
          opts.onPackageReady?.({
            packageName: name,
            data: { latestVersion: '2.0.0', allVersions: ['2.0.0', '1.5.0', '1.0.0'] },
          })
        }
      }
    )
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    projectDir = mkdtempSync(join(tmpdir(), 'inup-filter-'))
    writeFileSync(join(projectDir, 'package-lock.json'), '{}\n')
    writeJson(join(projectDir, 'package.json'), { name: 'fixture', dependencies: DEPENDENCIES })
    writeJson(join(projectDir, '.inuprc'), { ignore: ['left-pad'] })
  })

  afterEach(() => {
    log.mockRestore()
    warn.mockRestore()
    process.exitCode = undefined
    rmSync(projectDir, { recursive: true, force: true })
  })

  const report = () =>
    JSON.parse(
      log.mock.calls.map(([line]) => String(line)).find((line) => line.trim().startsWith('{')) ??
        '{}'
    )
  const warnings = () => warn.mock.calls.map(([line]) => String(line))

  it('asks the registry about the named packages only, and reports only them', async () => {
    await runCli(cliOptions(['react', 'eslint-*'], { json: true }))

    expect(requested()).toEqual(['eslint-plugin-x', 'react'])
    expect(
      report()
        .outdated.map((entry: { name: string }) => entry.name)
        .sort()
    ).toEqual(['eslint-plugin-x', 'react'])
    expect(warnings()).toEqual([])
  })

  it('warns about a typo and about a name the ignore list skips', async () => {
    await runCli(cliOptions(['react', 'recat', 'left-pad'], { json: true }))

    expect(requested()).toEqual(['react'])
    expect(warnings()).toEqual([
      'Warning: your ignore list (--ignore or .inuprc) skips left-pad',
      'Warning: no dependency matches recat',
    ])
  })

  it('gates --check on the named packages only', async () => {
    await runCli(cliOptions(['zod'], { check: true }))
    expect(process.exitCode).toBeUndefined()

    await runCli(cliOptions(['react'], { check: true }))
    expect(process.exitCode).toBe(1)
  })

  it('writes and installs only the named packages with --apply', async () => {
    await runCli(cliOptions(['react'], { apply: true, target: 'latest', json: true }))

    expect(readJson(join(projectDir, 'package.json')).dependencies).toEqual({
      ...DEPENDENCIES,
      react: '^2.0.0',
    })
    expect(mocks.spawnSync).toHaveBeenCalledTimes(1)
  })

  it('offers and upgrades only the named packages in the picker', async () => {
    const isTTY = [process.stdin.isTTY, process.stdout.isTTY]
    const ci = process.env.CI
    const setTTY = (stdin: boolean | undefined, stdout: boolean | undefined) => {
      Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true })
      Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true })
    }
    setTTY(true, true)
    delete process.env.CI
    try {
      await runCli(cliOptions(['react-dom']))
    } finally {
      setTTY(isTTY[0], isTTY[1])
      if (ci !== undefined) process.env.CI = ci
    }

    expect(mocks.pickerRows.map((pkg) => pkg.name)).toEqual(['react-dom'])
    expect(readJson(join(projectDir, 'package.json')).dependencies).toEqual({
      ...DEPENDENCIES,
      'react-dom': '^2.0.0',
    })
  })

  it('upgrades only the named pnpm catalog entry', async () => {
    rmSync(join(projectDir, 'package-lock.json'))
    writeFileSync(join(projectDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    writeFileSync(
      join(projectDir, 'pnpm-workspace.yaml'),
      'catalog:\n  react: ^1.0.0\n  vue: ^1.0.0\n'
    )
    writeJson(join(projectDir, 'package.json'), {
      name: 'fixture',
      dependencies: { react: 'catalog:', vue: 'catalog:' },
    })

    await runCli(cliOptions(['react'], { apply: true, target: 'latest', json: true }))

    expect(requested()).toEqual(['react'])
    expect(readFileSync(join(projectDir, 'pnpm-workspace.yaml'), 'utf-8')).toBe(
      'catalog:\n  react: ^2.0.0\n  vue: ^1.0.0\n'
    )
  })

  it('installs only the named global package with -g', async () => {
    mocks.spawnSync.mockImplementation((command: string) =>
      command.startsWith('npm ls -g')
        ? {
            status: 0,
            stdout: JSON.stringify({
              dependencies: { react: { version: '1.0.0' }, typescript: { version: '1.0.0' } },
            }),
          }
        : { status: 0, signal: null }
    )

    await runCli(cliOptions(['react'], { global: true, apply: true, target: 'latest', json: true }))

    expect(requested()).toEqual(['react'])
    const commands = mocks.spawnSync.mock.calls.map(([command]) => command)
    expect(commands).toEqual(['npm ls -g --depth=0 --json', 'npm install -g react@2.0.0'])
  })
})
