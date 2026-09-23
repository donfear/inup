import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A registry lookup that fails (expired private-registry token, network outage, unpublished
 * package) must never read as "up to date". This drives the real CLI → `PackageDetector` →
 * headless report chain over a temp project; only the registry and the audit are stubbed.
 */

const mocks = vi.hoisted(() => ({
  fetchPackageVersions: vi.fn(),
  fetchVulnerabilities: vi.fn(),
}))

vi.mock('../../src/shared/registry/npm-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/registry/npm-registry')>()
  return {
    ...actual,
    fetchPackageVersions: mocks.fetchPackageVersions,
  }
})

vi.mock('../../src/features/audit/vulnerability-checker', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/features/audit/vulnerability-checker')>()
  return {
    ...actual,
    fetchVulnerabilities: mocks.fetchVulnerabilities,
  }
})

import { runCli } from '../../src/cli'

// What the registry client hands back once every retry against a failing registry is spent.
const FAILED = { latestVersion: 'unknown', allVersions: [] }

let projectDir: string
const originalExitCode = process.exitCode

function cliOptions(overrides: Record<string, unknown>) {
  return {
    dir: projectDir,
    exclude: '',
    ignore: undefined,
    maxDepth: '10',
    native: false,
    ...overrides,
  } as any
}

/** Serve `versions` per package name; anything not listed fails the lookup. */
function mockRegistry(versions: Record<string, { latestVersion: string; allVersions: string[] }>) {
  mocks.fetchPackageVersions.mockImplementation(
    async (names: string[], opts: { onPackageReady?: (result: unknown) => void }) => {
      for (const name of names) {
        opts.onPackageReady?.({ packageName: name, data: versions[name] ?? FAILED })
      }
    }
  )
}

describe('failed registry lookups in headless runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
    mocks.fetchVulnerabilities.mockResolvedValue(new Map())

    projectDir = mkdtempSync(join(tmpdir(), 'inup-failed-'))
    writeFileSync(join(projectDir, 'package-lock.json'), '{}\n')
    writeFileSync(
      join(projectDir, 'package.json'),
      `${JSON.stringify({
        name: 'fixture-root',
        dependencies: { current: '^1.0.0', '@private/sdk': '^2.0.0' },
        devDependencies: { stale: '^1.0.0' },
      })}\n`
    )
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
    process.exitCode = originalExitCode
    vi.restoreAllMocks()
  })

  it('--json lists the failed lookups and --check exits 2', async () => {
    mockRegistry({
      current: { latestVersion: '1.0.0', allVersions: ['1.0.0'] },
      stale: { latestVersion: '1.0.0', allVersions: ['1.0.0'] },
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runCli(cliOptions({ json: true, check: true }))

    expect(log).toHaveBeenCalledTimes(1)
    const report = JSON.parse(String(log.mock.calls[0][0]))
    expect(report.schemaVersion).toBe(2)
    expect(report.summary).toMatchObject({ total: 3, outdated: 0, failed: 1 })
    expect(report.failed).toEqual([
      {
        name: '@private/sdk',
        current: '^2.0.0',
        type: 'dependencies',
        packageJsonPath: join(projectDir, 'package.json'),
      },
    ])
    expect(error).toHaveBeenCalledWith(expect.stringContaining('1 package(s) could not be checked'))
    expect(process.exitCode).toBe(2)
  })

  it('--check exits 2 even when updates also exist', async () => {
    mockRegistry({
      current: { latestVersion: '1.0.0', allVersions: ['1.0.0'] },
      stale: { latestVersion: '1.2.0', allVersions: ['1.2.0', '1.0.0'] },
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await runCli(cliOptions({ check: true }))

    expect(process.exitCode).toBe(2)
  })

  it('the plain report does not claim everything is up to date', async () => {
    mockRegistry({})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runCli(cliOptions({ check: true }))

    const stdout = log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(stdout).not.toContain('up to date')
    expect(stdout).toContain('3 package(s) could not be checked')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('3 package(s) could not be checked'))
    expect(process.exitCode).toBe(2)
  })

  it('a clean run still exits 0 with an empty failed list', async () => {
    mockRegistry({
      current: { latestVersion: '1.0.0', allVersions: ['1.0.0'] },
      stale: { latestVersion: '1.0.0', allVersions: ['1.0.0'] },
      '@private/sdk': { latestVersion: '2.0.0', allVersions: ['2.0.0'] },
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runCli(cliOptions({ json: true, check: true }))

    const report = JSON.parse(String(log.mock.calls[0][0]))
    expect(report.summary.failed).toBe(0)
    expect(report.failed).toEqual([])
    expect(error).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(0)
  })
})

describe('local workspace packages missing from the registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
    mocks.fetchVulnerabilities.mockResolvedValue(new Map())

    // An npm workspace whose app depends on an unpublished sibling by range, not `workspace:`.
    projectDir = mkdtempSync(join(tmpdir(), 'inup-local-'))
    writeFileSync(join(projectDir, 'package-lock.json'), '{}\n')
    const manifest = (dir: string, value: unknown) => {
      mkdirSync(join(projectDir, dir), { recursive: true })
      writeFileSync(join(projectDir, dir, 'package.json'), `${JSON.stringify(value)}\n`)
    }
    manifest('.', { name: 'fixture-root', private: true, workspaces: ['packages/*'] })
    manifest('packages/utils', { name: '@org/utils', version: '1.0.0', private: true })
    manifest('packages/app', {
      name: '@org/app',
      private: true,
      dependencies: { '@org/utils': '^1.0.0', stale: '^1.0.0' },
    })
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
    process.exitCode = originalExitCode
    vi.restoreAllMocks()
  })

  it('does not count an unpublished sibling as a failed lookup', async () => {
    mockRegistry({ stale: { latestVersion: '1.2.0', allVersions: ['1.2.0', '1.0.0'] } })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runCli(cliOptions({ json: true, check: true }))

    const report = JSON.parse(String(log.mock.calls[0][0]))
    expect(report.summary).toMatchObject({ total: 2, outdated: 1, failed: 0 })
    expect(report.failed).toEqual([])
    expect(error).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('still reports an unrelated package whose lookup failed', async () => {
    mockRegistry({ stale: { latestVersion: '1.0.0', allVersions: ['1.0.0'] } })
    writeFileSync(
      join(projectDir, 'packages/app/package.json'),
      `${JSON.stringify({
        name: '@org/app',
        dependencies: { '@org/utils': '^1.0.0', stale: '^1.0.0', '@vendor/sdk': '^3.0.0' },
      })}\n`
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await runCli(cliOptions({ json: true, check: true }))

    const report = JSON.parse(String(log.mock.calls[0][0]))
    expect(report.failed.map((entry: { name: string }) => entry.name)).toEqual(['@vendor/sdk'])
    expect(report.summary.failed).toBe(1)
    expect(process.exitCode).toBe(2)
  })
})
