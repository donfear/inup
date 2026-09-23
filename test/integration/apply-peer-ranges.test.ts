import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `--apply` never rewrites a peer range. A peer range states which host versions a library
 * supports; raising its floor silently drops support for everything below it. The same package
 * declared as a dependency is still bumped.
 *
 * Runs the real chain — `runCli` → `PackageDetector` → `HeadlessRunner` → `PackageUpgrader` —
 * over a real temp manifest. Only the registry, the audit and the install are stubbed.
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

// Package manager "not installed": the upgrader writes package.json and skips the real install.
vi.mock('../../src/shared/exec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/exec')>()
  return { ...actual, executeCommand: mocks.executeCommand }
})

import { runCli } from '../../src/cli'

const VERSIONS: Record<string, { latestVersion: string; allVersions: string[] }> = {
  lodash: { latestVersion: '5.0.0', allVersions: ['5.0.0', '4.18.1', '4.0.0'] },
  react: { latestVersion: '19.2.0', allVersions: ['19.2.0', '18.3.1', '16.8.0'] },
}

let projectDir: string

function readManifest() {
  return JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'))
}

describe('--apply leaves peer ranges untouched', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchVulnerabilities.mockResolvedValue(new Map())
    mocks.executeCommand.mockImplementation(() => {
      throw new Error('not installed')
    })
    mocks.fetchPackageVersions.mockImplementation(
      async (names: string[], opts: { onPackageReady?: (result: unknown) => void }) => {
        for (const name of names) {
          opts.onPackageReady?.({ packageName: name, data: VERSIONS[name] })
        }
      }
    )

    projectDir = mkdtempSync(join(tmpdir(), 'inup-apply-peers-'))
    writeFileSync(join(projectDir, 'package-lock.json'), '{}\n')
    writeFileSync(
      join(projectDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'fixture-library',
          dependencies: { lodash: '^4.0.0' },
          peerDependencies: { lodash: '^4.0.0', react: '>=16.8.0' },
        },
        null,
        2
      )}\n`
    )
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it.each([
    ['minor', '^4.18.1'],
    ['latest', '^5.0.0'],
  ] as const)(
    '--target %s bumps the dependency to %s and keeps every peer range',
    async (target, bumped) => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await runCli({
        dir: projectDir,
        exclude: '',
        ignore: '',
        maxDepth: '10',
        apply: true,
        target,
        json: true,
      })

      const manifest = readManifest()
      expect(manifest.dependencies.lodash).toBe(bumped)
      expect(manifest.peerDependencies).toEqual({ lodash: '^4.0.0', react: '>=16.8.0' })

      // Reporting is unchanged: the peer ranges are still listed as outdated.
      const json = logSpy.mock.calls.map((c) => String(c[0])).find((s) => s.trim().startsWith('{'))
      const report = JSON.parse(json as string)
      const peers = report.outdated.filter((e: { type: string }) => e.type === 'peerDependencies')
      expect(peers.map((e: { name: string }) => e.name).sort()).toEqual(['lodash', 'react'])

      logSpy.mockRestore()
    }
  )
})
