import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * End-to-end contract for the default unattended write (`--apply --target minor`, what the
 * GitHub Action runs): the in-range target follows the specifier's operator, and whatever that
 * target no longer reaches is still reported as the latest update.
 *
 * Real chain — `runCli` → `PackageDetector` → `HeadlessRunner` → `PackageUpgrader` write — over a
 * temp project. Only the registry, the audit and the package-manager install are stubbed.
 */

const mocks = vi.hoisted(() => ({
  fetchPackageVersions: vi.fn(),
  fetchVulnerabilities: vi.fn(),
  executeCommand: vi.fn(),
}))

vi.mock('../../src/shared/registry/npm-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/registry/npm-registry')>()
  return { ...actual, fetchPackageVersions: mocks.fetchPackageVersions }
})

vi.mock('../../src/features/audit/vulnerability-checker', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/features/audit/vulnerability-checker')>()
  return { ...actual, fetchVulnerabilities: mocks.fetchVulnerabilities }
})

// Package manager "not installed": the upgrader writes package.json and skips the install.
vi.mock('../../src/shared/exec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/exec')>()
  return { ...actual, executeCommand: mocks.executeCommand }
})

import { runCli } from '../../src/cli'

// Registry order is deliberately NOT newest-first: the target search must not depend on it.
const REGISTRY: Record<string, { latestVersion: string; allVersions: string[] }> = {
  'zero-lib': {
    latestVersion: '0.9.1',
    allVersions: ['0.2.3', '0.2.4', '0.2.9', '0.3.0', '0.9.0', '0.9.1'],
  },
  'tilde-lib': {
    latestVersion: '1.9.0',
    allVersions: ['1.2.3', '1.2.9', '1.3.0', '1.9.0'],
  },
}

let projectDir: string

describe('--apply --target minor follows the specifier operator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchVulnerabilities.mockResolvedValue(new Map())
    mocks.executeCommand.mockImplementation(() => {
      throw new Error('not installed')
    })
    mocks.fetchPackageVersions.mockImplementation(
      async (names: string[], opts: { onPackageReady?: (result: unknown) => void }) => {
        for (const name of names) {
          opts.onPackageReady?.({ packageName: name, data: REGISTRY[name] })
        }
      }
    )

    projectDir = mkdtempSync(join(tmpdir(), 'inup-range-target-'))
    writeFileSync(join(projectDir, 'package-lock.json'), '{}\n')
    writeFileSync(
      join(projectDir, 'package.json'),
      `${JSON.stringify(
        { name: 'fixture', dependencies: { 'zero-lib': '^0.2.3', 'tilde-lib': '~1.2.3' } },
        null,
        2
      )}\n`
    )
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  // The real CLI chain loads cold through dynamic imports: give a busy runner room.
  it('keeps ^0.2.3 within 0.2.x and ~1.2.3 within 1.2.x, reporting the rest as latest', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli({
      dir: projectDir,
      exclude: '',
      ignore: undefined,
      maxDepth: '10',
      apply: true,
      target: 'minor',
      json: true,
    } as any)

    const json = logSpy.mock.calls.map((c) => String(c[0])).find((s) => s.trim().startsWith('{'))
    logSpy.mockRestore()
    const report = JSON.parse(json as string)
    const entry = (name: string) => report.outdated.find((e: { name: string }) => e.name === name)

    // Written: the newest version each declared range allows — never a breaking 0.x minor.
    const written = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'))
    expect(written.dependencies).toEqual({ 'zero-lib': '^0.2.9', 'tilde-lib': '~1.2.9' })

    // Reported: the out-of-range versions stay visible as the latest update.
    expect(entry('zero-lib')).toMatchObject({
      current: '^0.2.3',
      range: '0.2.9',
      latest: '0.9.1',
      hasMajorUpdate: true,
    })
    expect(entry('tilde-lib')).toMatchObject({
      current: '~1.2.3',
      range: '1.2.9',
      latest: '1.9.0',
      hasMajorUpdate: true,
    })
    expect(report.summary).toMatchObject({ outdated: 2, major: 2 })
  }, 30_000)
})
