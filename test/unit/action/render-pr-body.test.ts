import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const baseSummary = { total: 0, outdated: 0, major: 0, vulnerable: 0 }

// Import via an explicit file:// URL rather than a relative specifier: Vite's SSR module
// runner externalizes .mjs files, and on Windows a relative specifier through that path
// resolves/transforms incorrectly and throws a SyntaxError at import time.
const actionModuleUrl = pathToFileURL(join(process.cwd(), 'action/render-pr-body.mjs')).href

async function renderPrBody(report: object): Promise<string> {
  const { render } = await import(actionModuleUrl)
  return `${render(report)}\n`
}

function writeTempFile(content: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'inup-pr-body-'))
  const path = join(dir, 'report.json')
  writeFileSync(path, content, 'utf8')
  return { dir, path }
}

function renderFromStdin(input: string) {
  return spawnSync(process.execPath, ['action/render-pr-body.mjs', '-'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input,
  })
}

describe('render-pr-body action helper', () => {
  it('renders the empty up-to-date body', async () => {
    const body = await renderPrBody({
      schemaVersion: 1,
      summary: { ...baseSummary, total: 12 },
      outdated: [],
    })

    expect(body).toContain('Scanned **12** packages — **0** unique upgrade(s)')
    expect(body).toContain('Everything is up to date. 🎉')
    expect(body).not.toContain('### Updates')
  })

  it('shows applied in-range targets with the package.json version prefix preserved', async () => {
    const body = await renderPrBody({
      schemaVersion: 1,
      summary: { total: 3, outdated: 3, major: 0, vulnerable: 0 },
      outdated: [
        {
          name: 'caret-package',
          current: '^7.3.1',
          range: '7.3.2',
          latest: '7.3.2',
          type: 'dependencies',
          packageJsonPath: '/repo/package.json',
          hasMajorUpdate: false,
        },
        {
          name: 'tilde-package',
          current: '~2.1.0',
          range: '2.1.4',
          latest: '2.1.4',
          type: 'devDependencies',
          packageJsonPath: '/repo/package.json',
          hasMajorUpdate: false,
        },
        {
          name: 'exact-package',
          current: '1.0.0',
          range: '1.0.1',
          latest: '1.0.1',
          type: 'optionalDependencies',
          packageJsonPath: '/repo/package.json',
          hasMajorUpdate: false,
        },
      ],
    })

    expect(body).toContain('- `caret-package` `^7.3.1` → `^7.3.2` (dependencies)')
    expect(body).toContain('- `tilde-package` `~2.1.0` → `~2.1.4` (devDependencies)')
    expect(body).toContain('- `exact-package` `1.0.0` → `1.0.1` (optionalDependencies)')
    expect(body).toContain(
      '| `caret-package` | ^7.3.1 | ^7.3.2 | 7.3.2 | dependencies | ✅ | — | — |'
    )
    expect(body).toContain(
      '| `tilde-package` | ~2.1.0 | ~2.1.4 | 2.1.4 | devDependencies | ✅ | — | — |'
    )
  })

  it('deduplicates workspace entries and reports both unique and raw counts', async () => {
    const body = await renderPrBody({
      schemaVersion: 1,
      summary: { ...baseSummary, total: 8, outdated: 2 },
      outdated: [
        {
          name: '@scope/pkg',
          current: '^1.0.0',
          range: '1.1.0',
          latest: '1.1.0',
          type: 'dependencies',
          packageJsonPath: '/repo/package.json',
          hasMajorUpdate: false,
        },
        {
          name: '@scope/pkg',
          current: '^1.0.0',
          range: '1.1.0',
          latest: '1.1.0',
          type: 'devDependencies',
          packageJsonPath: '/repo/packages/app/package.json',
          hasMajorUpdate: false,
        },
      ],
    })

    expect(body).toContain('**1** unique upgrade(s) (2 across workspaces)')
    expect(body.match(/\| `@scope\/pkg` \|/g)).toHaveLength(1)
    expect(body).toContain('- `@scope/pkg` `^1.0.0` → `^1.1.0` (dependencies)')
  })

  it('marks major-only updates as not applied and lists them separately', async () => {
    const body = await renderPrBody({
      schemaVersion: 1,
      summary: { ...baseSummary, total: 1, outdated: 1, major: 1 },
      outdated: [
        {
          name: 'major-only',
          current: '^4.0.0',
          range: '4.0.0',
          latest: '5.0.0',
          type: 'dependencies',
          packageJsonPath: '/repo/package.json',
          hasMajorUpdate: true,
        },
      ],
    })

    expect(body).toContain('_No in-range upgrades were applied — see skipped majors below._')
    expect(body).toContain(
      '| `major-only` | ^4.0.0 | ^4.0.0 | 5.0.0 | dependencies | — | ⚠️ yes | — |'
    )
    expect(body).toContain('### ⏭️ Major updates available (not applied)')
    expect(body).toContain('- `major-only` (current `^4.0.0`) → **5.0.0** (dependencies)')
  })

  it('renders security verdicts and advisory fix status for each branch', async () => {
    const body = await renderPrBody({
      schemaVersion: 1,
      summary: { ...baseSummary, total: 3, outdated: 3, vulnerable: 3 },
      outdated: [
        {
          name: 'range-fix',
          current: '^1.0.0',
          range: '1.0.1',
          latest: '1.0.1',
          type: 'dependencies',
          packageJsonPath: '/repo/package.json',
          hasMajorUpdate: false,
          vulnerability: {
            count: 1,
            highestSeverity: 'critical',
            fixedByRange: true,
            fixedByLatest: true,
            advisories: [
              {
                id: 1,
                title: 'Prototype pollution',
                severity: 'high',
                url: 'https://example.com/range',
                vulnerableVersions: '<1.0.1',
                fixedByRange: true,
                fixedByLatest: true,
              },
            ],
          },
        },
        {
          name: 'major-fix',
          current: '^2.0.0',
          range: '2.0.1',
          latest: '3.0.0',
          type: 'devDependencies',
          packageJsonPath: '/repo/package.json',
          hasMajorUpdate: true,
          vulnerability: {
            count: 1,
            highestSeverity: 'moderate',
            fixedByRange: false,
            fixedByLatest: true,
            advisories: [
              {
                id: 2,
                title: 'Needs major',
                severity: 'low',
                url: 'https://example.com/major',
                vulnerableVersions: '<3.0.0',
                fixedByRange: false,
                fixedByLatest: true,
              },
            ],
          },
        },
        {
          name: 'no-fix',
          current: '^4.0.0',
          range: '4.0.1',
          latest: '4.0.1',
          type: 'optionalDependencies',
          packageJsonPath: '/repo/package.json',
          hasMajorUpdate: false,
          vulnerability: {
            count: 1,
            highestSeverity: 'unknown-severity',
            fixedByRange: false,
            fixedByLatest: false,
            advisories: [
              {
                id: 3,
                title: 'Still vulnerable',
                severity: 'info',
                url: 'https://example.com/no-fix',
                vulnerableVersions: '<=4.0.1',
                fixedByRange: false,
                fixedByLatest: false,
              },
            ],
          },
        },
      ],
    })

    expect(body).toContain('### 🔒 Security')
    expect(body).toContain(
      '| `range-fix` | ^1.0.0 | ^1.0.1 | 1.0.1 | dependencies | ✅ | — | 🟢 fixed by in-range bump |'
    )
    expect(body).toContain(
      '| `major-fix` | ^2.0.0 | ^2.0.1 | 3.0.0 | devDependencies | ✅ | ⚠️ yes | 🟠 fixed only by major (latest) |'
    )
    expect(body).toContain(
      '| `no-fix` | ^4.0.0 | ^4.0.1 | 4.0.1 | optionalDependencies | ✅ | — | 🔴 not fixed by any upgrade |'
    )
    expect(body).toContain('highest 🟣 critical — 🟢 fixed by in-range bump')
    expect(body).toContain('highest 🟠 moderate — 🟠 fixed only by major (latest)')
    expect(body).toContain('highest unknown-severity — 🔴 not fixed by any upgrade')
    expect(body).toContain('(🔴 high, affects `<1.0.1`) — cleared by in-range bump')
    expect(body).toContain('(🟡 low, affects `<3.0.0`) — cleared only by major')
    expect(body).toContain('(ℹ️ info, affects `<=4.0.1`) — not cleared by upgrade')
  })

  it('escapes pipes in table cells', async () => {
    const body = await renderPrBody({
      schemaVersion: 1,
      summary: { ...baseSummary, total: 1, outdated: 1, vulnerable: 1 },
      outdated: [
        {
          name: 'pkg|name',
          current: '^1.0.0',
          range: '1.0.1',
          latest: '1.0.1',
          type: 'dependencies',
          packageJsonPath: '/repo/package.json',
          hasMajorUpdate: false,
          vulnerability: {
            count: 1,
            highestSeverity: 'high',
            fixedByRange: true,
            fixedByLatest: true,
            advisories: [
              {
                id: 1,
                title: 'bad | title',
                severity: 'moderate',
                url: 'https://example.com/pipe',
                vulnerableVersions: '<1.0.1 || >=2.0.0',
                fixedByRange: true,
                fixedByLatest: true,
              },
            ],
          },
        },
      ],
    })

    expect(body).toContain(
      '| `pkg\\|name` | ^1.0.0 | ^1.0.1 | 1.0.1 | dependencies | ✅ | — | 🟢 fixed by in-range bump |'
    )
    expect(body).toContain('[bad \\| title](https://example.com/pipe)')
    expect(body).toContain('affects `<1.0.1 \\|\\| >=2.0.0`')
  })

  it('annotates catalog-sourced upgrades everywhere they appear', async () => {
    const body = await renderPrBody({
      schemaVersion: 1,
      summary: { ...baseSummary, total: 2, outdated: 2 },
      outdated: [
        {
          name: 'react',
          current: '^18.2.0',
          range: '18.3.1',
          latest: '19.2.0',
          type: 'dependencies',
          packageJsonPath: '/repo/pnpm-workspace.yaml',
          catalog: 'default',
          hasMajorUpdate: true,
        },
        {
          name: 'ms',
          current: '^2.0.0',
          range: '2.1.3',
          latest: '2.1.3',
          type: 'dependencies',
          packageJsonPath: '/repo/packages/api/package.json',
          hasMajorUpdate: false,
        },
      ],
    })

    // Applied list, table, and skipped-majors all say where the bump lands.
    expect(body).toContain('- `react` `^18.2.0` → `^18.3.1` (dependencies · catalog:default)')
    expect(body).toContain('| dependencies · catalog:default |')
    expect(body).toContain(
      '- `react` (current `^18.2.0`) → **19.2.0** (dependencies · catalog:default)'
    )
    // Non-catalog entries stay unannotated.
    expect(body).toContain('- `ms` `^2.0.0` → `^2.1.3` (dependencies)')
  })

  it('keeps a catalog entry distinct from a same-range direct dependency', async () => {
    const shared = {
      current: '^18.2.0',
      range: '18.3.1',
      latest: '18.3.1',
      type: 'dependencies',
      hasMajorUpdate: false,
    }
    const body = await renderPrBody({
      schemaVersion: 1,
      summary: { ...baseSummary, total: 2, outdated: 2 },
      outdated: [
        {
          name: 'react',
          ...shared,
          packageJsonPath: '/repo/pnpm-workspace.yaml',
          catalog: 'default',
        },
        { name: 'react', ...shared, packageJsonPath: '/repo/packages/legacy/package.json' },
      ],
    })

    // Two write locations → two applied lines, not one deduped line.
    expect(body).toContain('(dependencies · catalog:default)')
    expect(body).toContain('- `react` `^18.2.0` → `^18.3.1` (dependencies)')
    expect(body).toContain('**2** unique upgrade(s)')
  })

  it('falls back to a minimal body for malformed stdin', () => {
    const result = renderFromStdin('{not json')

    expect(result.status).toBe(0)
    expect(result.stdout).toBe(
      '## 📦 Dependency upgrades\n\nSee the diff for upgraded dependencies.\n'
    )
    expect(result.stderr).toContain('render-pr-body:')
  })

  it('reads report JSON from a file path and stdin handle', async () => {
    const { readInput } = await import(actionModuleUrl)
    const file = writeTempFile(
      JSON.stringify({
        schemaVersion: 1,
        summary: { ...baseSummary, total: 4 },
        outdated: [],
      })
    )

    try {
      expect(readInput(['node', 'render-pr-body.mjs', file.path]).summary.total).toBe(4)
      expect(readInput(['node', 'render-pr-body.mjs'], file.path).summary.total).toBe(4)
    } finally {
      rmSync(file.dir, { recursive: true, force: true })
    }
  })

  it('main writes the rendered body for a valid report file', async () => {
    const { main } = await import(actionModuleUrl)
    const file = writeTempFile(
      JSON.stringify({
        schemaVersion: 1,
        summary: { ...baseSummary, total: 2 },
        outdated: [],
      })
    )
    let stdout = ''
    let stderr = ''

    try {
      main({
        argv: ['node', 'render-pr-body.mjs', file.path],
        stdout: { write: (chunk: string) => (stdout += chunk) },
        stderr: { write: (chunk: string) => (stderr += chunk) },
      })
    } finally {
      rmSync(file.dir, { recursive: true, force: true })
    }

    expect(stdout).toContain('Scanned **2** packages')
    expect(stderr).toBe('')
  })

  it('main writes the fallback body for a malformed report file', async () => {
    const { main } = await import(actionModuleUrl)
    const file = writeTempFile('{not json')
    let stdout = ''
    let stderr = ''

    try {
      main({
        argv: ['node', 'render-pr-body.mjs', file.path],
        stdout: { write: (chunk: string) => (stdout += chunk) },
        stderr: { write: (chunk: string) => (stderr += chunk) },
      })
    } finally {
      rmSync(file.dir, { recursive: true, force: true })
    }

    expect(stdout).toBe('## 📦 Dependency upgrades\n\nSee the diff for upgraded dependencies.\n')
    expect(stderr).toContain('render-pr-body:')
  })

  it('covers small exported helpers used by the process entrypoint', async () => {
    const { isDirectRun, vulnVerdict } = await import(actionModuleUrl)
    const scriptPath = join(process.cwd(), 'action/render-pr-body.mjs')

    expect(vulnVerdict()).toBe('')
    expect(isDirectRun(['node'], pathToFileURL(scriptPath).href)).toBe(false)
    expect(isDirectRun(['node', scriptPath], pathToFileURL(scriptPath).href)).toBe(true)
  })
})

describe('render-pr-body release-age cooldown section', () => {
  const hold = (overrides = {}) => ({
    name: 'axios',
    type: 'dependencies',
    packageJsonPath: '/repo/package.json',
    version: '1.9.0',
    publishedAt: '2024-06-01T00:00:00.000Z',
    ageMinutes: 30,
    eligibleInMinutes: 1410, // a 1-day window, 30 minutes in
    count: 1,
    ...overrides,
  })

  it('renders the held table when nothing was upgraded', async () => {
    // Reporting "up to date" while the cooldown withholds a version would tell a
    // reviewer there is nothing newer — the opposite of what the control means.
    const body = await renderPrBody({
      schemaVersion: 2,
      summary: { ...baseSummary, total: 12, heldByCooldown: 1 },
      outdated: [],
      heldByCooldown: [hold()],
    })

    expect(body).not.toContain('Everything is up to date. 🎉')
    expect(body).toContain('### ⏳ Held by release-age cooldown')
    expect(body).toContain('| `axios` | 1.9.0 | 30m ago | 23h | 1 |')
  })

  it('appends the held table after the upgrade sections', async () => {
    const body = await renderPrBody({
      schemaVersion: 2,
      summary: { ...baseSummary, total: 5, outdated: 1, heldByCooldown: 1 },
      outdated: [
        {
          name: 'lodash',
          current: '^4.17.20',
          range: '4.17.21',
          latest: '4.17.21',
          type: 'dependencies',
          packageJsonPath: '/repo/package.json',
          hasMajorUpdate: false,
        },
      ],
      heldByCooldown: [hold({ ageMinutes: 4320, eligibleInMinutes: 5760, count: 3 })],
    })

    expect(body).toContain('### ✅ Applied in this PR')
    expect(body).toContain('| `axios` | 1.9.0 | 3d ago | 4d | 3 |')
    expect(body.indexOf('### Updates')).toBeLessThan(body.indexOf('Held by release-age cooldown'))
  })

  it('collapses monorepo duplicates of the same held version', async () => {
    const body = await renderPrBody({
      schemaVersion: 2,
      summary: { ...baseSummary, total: 3, heldByCooldown: 2 },
      outdated: [],
      heldByCooldown: [hold(), hold({ packageJsonPath: '/repo/apps/web/package.json' })],
    })

    expect(body.match(/\| `axios` \|/g)).toHaveLength(1)
  })

  it('renders sub-day ages in hours', async () => {
    const body = await renderPrBody({
      schemaVersion: 2,
      summary: { ...baseSummary, total: 3, heldByCooldown: 1 },
      outdated: [],
      heldByCooldown: [hold({ ageMinutes: 150, eligibleInMinutes: 90 })],
    })

    expect(body).toContain('| `axios` | 1.9.0 | 2h ago | 1h | 1 |')
  })

  it('says "next run" rather than a zero wait for a version about to clear', async () => {
    const body = await renderPrBody({
      schemaVersion: 2,
      summary: { ...baseSummary, total: 3, heldByCooldown: 1 },
      outdated: [],
      heldByCooldown: [hold({ ageMinutes: 1440, eligibleInMinutes: 0 })],
    })

    expect(body).toContain('| next run |')
  })

  it('warns in the PR body when the cooldown could not act', async () => {
    // In CI nobody reads stderr; the PR body is the only place a reviewer would learn
    // the supply-chain guard they configured did nothing.
    const body = await renderPrBody({
      schemaVersion: 2,
      summary: { ...baseSummary, total: 12, heldByCooldown: 0 },
      outdated: [],
      heldByCooldown: [],
      cooldown: { minimumReleaseAge: 10080, publishTimesAvailable: false },
    })

    expect(body).toContain('[!WARNING]')
    expect(body).toContain('**10080** minutes, but the registry returned no publish times')
    expect(body).toContain('no effect')
  })

  it('stays quiet when the cooldown ran normally', async () => {
    const body = await renderPrBody({
      schemaVersion: 2,
      summary: { ...baseSummary, total: 12, heldByCooldown: 1 },
      outdated: [],
      heldByCooldown: [hold()],
      cooldown: { minimumReleaseAge: 10080, publishTimesAvailable: true },
    })

    expect(body).not.toContain('[!WARNING]')
    expect(body).toContain('Held by release-age cooldown')
  })

  it('omits the section for a schemaVersion 1 report with no held field', async () => {
    const body = await renderPrBody({
      schemaVersion: 1,
      summary: { ...baseSummary, total: 12 },
      outdated: [],
    })

    expect(body).toContain('Everything is up to date. 🎉')
    expect(body).not.toContain('Held by release-age cooldown')
  })
})
