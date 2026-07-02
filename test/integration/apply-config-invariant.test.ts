import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * End-to-end safety contract for `--apply`: the set inup *writes* must equal the set it *reports*,
 * which must equal the config-filtered set. A package the `.inuprc` ignores, or one under an
 * excluded path, must be neither in the JSON report nor written to disk.
 *
 * This exercises the *real* chain — `loadProjectConfig` → `PackageDetector` filtering →
 * `PackageUpgrader` write — over a real temp filesystem. Only the npm registry, the vulnerability
 * audit, and the package-manager install are stubbed; the config + filtering + write logic is real.
 */

const mocks = vi.hoisted(() => ({
  fetchPackageVersions: vi.fn(),
  fetchVulnerabilities: vi.fn(),
  executeCommand: vi.fn(),
}))

// Registry: every package resolves to 2.0.0 latest with a 1.x line available in-range.
vi.mock('../../src/services/npm-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/npm-registry')>()
  return {
    ...actual,
    fetchPackageVersions: mocks.fetchPackageVersions,
  }
})

vi.mock('../../src/services/vulnerability-checker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/vulnerability-checker')>()
  return {
    ...actual,
    fetchVulnerabilities: mocks.fetchVulnerabilities,
  }
})

// Make the package manager appear "not installed" so the upgrader writes package.json but skips
// the real install (graceful path in PackageUpgrader.runInstall). Keeps the test hermetic.
vi.mock('../../src/shared/exec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/exec')>()
  return {
    ...actual,
    executeCommand: mocks.executeCommand,
  }
})

import { runCli } from '../../src/cli'

let projectDir: string

// Defaults matching Commander's option defaults, so runCli sees a realistic CliOptions.
function cliOptions(overrides: Record<string, unknown>) {
  return {
    dir: projectDir,
    exclude: '',
    ignore: undefined,
    maxDepth: '10',
    ...overrides,
  } as any
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

describe('--apply respects .inuprc (config-filtered == reported == written)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchVulnerabilities.mockResolvedValue(new Map())
    // PM "not installed" → skip install, still write package.json.
    mocks.executeCommand.mockImplementation(() => {
      throw new Error('not installed')
    })
    mocks.fetchPackageVersions.mockImplementation(
      async (names: string[], opts: { onBatchReady?: (batch: unknown[]) => void }) => {
        opts.onBatchReady?.(
          names.map((name) => ({
            packageName: name,
            data: { latestVersion: '2.0.0', allVersions: ['2.0.0', '1.5.0', '1.0.0'] },
          }))
        )
      }
    )

    projectDir = mkdtempSync(join(tmpdir(), 'inup-apply-'))
    // npm lockfile so the detector picks npm; presence is enough for this test.
    writeFileSync(join(projectDir, 'package-lock.json'), '{}\n')

    // Root manifest: `keep` should be upgraded; `ignored-pkg` is ignored by .inuprc.
    writeJson(join(projectDir, 'package.json'), {
      name: 'fixture-root',
      dependencies: { keep: '^1.0.0', 'ignored-pkg': '^1.0.0' },
    })

    // An excluded sub-path with its own manifest — must never be scanned or written.
    const excludedDir = join(projectDir, 'packages', 'skipme')
    mkdirSync(excludedDir, { recursive: true })
    writeJson(join(excludedDir, 'package.json'), {
      name: 'fixture-excluded',
      dependencies: { 'excluded-pkg': '^1.0.0' },
    })

    // .inuprc: ignore one package by name, exclude the sub-path by regex.
    writeJson(join(projectDir, '.inuprc'), {
      ignore: ['ignored-pkg'],
      exclude: ['^packages/skipme(?:/|$)'],
    })
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('writes only the kept package; ignored + excluded are absent from report and disk', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // Drive the real CLI entry so `.inuprc` is loaded + merged exactly as in production.
    await runCli(cliOptions({ apply: true, target: 'latest', json: true }))

    // ---- Report (stdout JSON) ----
    const jsonCall = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((s) => s.trim().startsWith('{'))
    expect(jsonCall).toBeTruthy()
    const report = JSON.parse(jsonCall as string)
    const reportedNames = report.outdated.map((e: { name: string }) => e.name)
    expect(reportedNames).toContain('keep')
    expect(reportedNames).not.toContain('ignored-pkg') // ignored by .inuprc
    expect(reportedNames).not.toContain('excluded-pkg') // under an excluded path

    // ---- Disk (root manifest) ----
    const rootPkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'))
    expect(rootPkg.dependencies.keep).toBe('^2.0.0') // bumped to latest, prefix preserved
    expect(rootPkg.dependencies['ignored-pkg']).toBe('^1.0.0') // untouched

    // ---- Disk (excluded manifest) ----
    const excludedPkg = JSON.parse(
      readFileSync(join(projectDir, 'packages', 'skipme', 'package.json'), 'utf-8')
    )
    expect(excludedPkg.dependencies['excluded-pkg']).toBe('^1.0.0') // never written

    logSpy.mockRestore()
  })
})
