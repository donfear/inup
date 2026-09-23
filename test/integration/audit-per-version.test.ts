import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A monorepo can declare one package at different versions — lodash@^3 in one workspace,
 * lodash@^4 in another. The `--json` report must attribute advisories per declaration: the 3.x
 * entry carries the 3.x advisory, the 4.x entry carries none. Real scan + detector over a temp
 * filesystem; only the registry and the advisory endpoint are stubbed.
 */

const mocks = vi.hoisted(() => ({
  fetchPackageVersions: vi.fn(),
  fetchVulnerabilities: vi.fn(),
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

import { HeadlessRunner } from '../../src/features/headless'

let projectDir: string

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

describe('headless audit in a monorepo with one package at two versions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchPackageVersions.mockImplementation(
      async (names: string[], opts: { onPackageReady?: (result: unknown) => void }) => {
        for (const name of names) {
          opts.onPackageReady?.({
            packageName: name,
            data: { latestVersion: '4.17.23', allVersions: ['4.17.23', '4.17.21', '3.10.1'] },
          })
        }
      }
    )
    // The advisory only affects the 3.x line.
    mocks.fetchVulnerabilities.mockImplementation(async (packages: Map<string, string>) =>
      packages.get('lodash') === '^3.10.1'
        ? new Map([
            [
              'lodash',
              {
                packageName: 'lodash',
                highestSeverity: 'critical',
                vulnerabilities: [
                  {
                    id: 1,
                    title: 'Prototype Pollution',
                    severity: 'critical',
                    url: 'https://github.com/advisories/GHSA-3',
                    vulnerable_versions: '<4.17.12',
                  },
                ],
              },
            ],
          ])
        : new Map()
    )

    projectDir = mkdtempSync(join(tmpdir(), 'inup-audit-'))
    writeJson(join(projectDir, 'package.json'), {
      name: 'fixture-root',
      private: true,
      workspaces: ['packages/*'],
    })
    for (const [dir, spec] of [
      ['legacy', '^3.10.1'],
      ['modern', '^4.17.21'],
    ]) {
      mkdirSync(join(projectDir, 'packages', dir), { recursive: true })
      writeJson(join(projectDir, 'packages', dir, 'package.json'), {
        name: `fixture-${dir}`,
        dependencies: { lodash: spec },
      })
    }
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('attributes advisories to the declaration they were reported for', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await new HeadlessRunner({ cwd: projectDir }).run({ json: true })

      const report = JSON.parse(String(logSpy.mock.calls[0][0]))
      const entries = report.outdated.filter((entry: { name: string }) => entry.name === 'lodash')
      const bySpec = new Map(
        entries.map((entry: { current: string }) => [entry.current, entry] as const)
      )
      expect(Array.from(bySpec.keys()).sort()).toEqual(['^3.10.1', '^4.17.21'])
      expect(bySpec.get('^3.10.1')).toMatchObject({
        vulnerability: { count: 1, highestSeverity: 'critical', fixedByLatest: true },
      })
      expect(bySpec.get('^4.17.21')).not.toHaveProperty('vulnerability')
      expect(report.summary.vulnerable).toBe(1)
    } finally {
      logSpy.mockRestore()
    }
  })
})
