import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function renderPrBody(report: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'inup-pr-body-'))
  const reportPath = join(dir, 'report.json')

  try {
    writeFileSync(reportPath, JSON.stringify(report), 'utf8')
    return execFileSync(process.execPath, ['action/render-pr-body.mjs', reportPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('render-pr-body action helper', () => {
  it('shows applied in-range targets with the package.json version prefix preserved', () => {
    const body = renderPrBody({
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
})
