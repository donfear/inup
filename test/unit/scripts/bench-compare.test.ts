import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  countManifests,
  FIXTURES,
  quote,
  resetBoxCommand,
  sandboxEnv,
  shellCommand,
  TOOLS,
} from '../../../scripts/bench-compare.mjs'

const tool = (id: string) => {
  const found = TOOLS.find((candidate: { id: string }) => candidate.id === id)
  if (!found) throw new Error(`no tool ${id}`)
  return found
}

const single = { pm: 'npm', workspaces: false }
const npmWorkspace = { pm: 'npm', workspaces: true }
const pnpmWorkspace = { pm: 'pnpm', workspaces: true }

describe('FIXTURES', () => {
  it('pins every repository to a full commit', () => {
    for (const fixture of FIXTURES) {
      expect(fixture.sha).toMatch(/^[0-9a-f]{40}$/)
      expect(fixture.repo).toMatch(/^[\w.-]+\/[\w.-]+$/)
    }
    expect(new Set(FIXTURES.map((fixture: { id: string }) => fixture.id)).size).toBe(
      FIXTURES.length
    )
  })
})

describe('TOOLS', () => {
  it('asks every tool for every update, workspaces included, without writing', () => {
    expect(tool('inup').args(pnpmWorkspace)).toEqual(['--json'])
    expect(tool('ncu').args(single)).toEqual(['--jsonUpgraded'])
    expect(tool('ncu').args(pnpmWorkspace)).toEqual(['--jsonUpgraded', '--workspaces'])
    expect(tool('taze').args(single)).toEqual([
      'major',
      '--include-locked',
      '--no-github-actions',
      '--no-node-version',
      '--json',
    ])
    expect(tool('taze').args(pnpmWorkspace)).toContain('--recursive')
    expect(tool('npm-check').args(single)).toEqual(['--skip-unused'])
    for (const { args } of TOOLS) {
      for (const flag of ['-u', '--upgrade', '-w', '--write', '--install', '--update']) {
        expect(args(pnpmWorkspace)).not.toContain(flag)
      }
    }
  })

  it("runs the fixture's own package manager", () => {
    const pm = tool('pm')
    expect(pm.name(single)).toBe('npm outdated')
    expect(pm.args(single)).toEqual(['outdated', '--json'])
    expect(pm.args(npmWorkspace)).toEqual([
      'outdated',
      '--workspaces',
      '--include-workspace-root',
      '--json',
    ])
    expect(pm.name(pnpmWorkspace)).toBe('pnpm outdated')
    expect(pm.args(pnpmWorkspace)).toEqual(['outdated', '--recursive', '--format', 'json'])
  })

  it('skips npm-check on workspaces only', () => {
    expect(tool('npm-check').unsupported(single)).toBeNull()
    expect(tool('npm-check').unsupported(pnpmWorkspace)).toBe('no workspace support')
  })

  it('accepts exit code 1 only from the tools that use it for "found updates"', () => {
    const failing = TOOLS.filter(
      (candidate: { failsWhenOutdated?: boolean }) => candidate.failsWhenOutdated
    )
    expect(failing.map((candidate: { id: string }) => candidate.id)).toEqual(['npm-check', 'pm'])
  })

  it('counts the updates in each JSON report', () => {
    expect(tool('inup').count(JSON.stringify({ summary: { outdated: 22 } }))).toBe(22)
    expect(tool('ncu').count(JSON.stringify({ a: '^2.0.0', b: '^3.0.0' }))).toBe(2)
    expect(
      tool('ncu').count(
        JSON.stringify({
          'package.json': { a: '^2.0.0' },
          'packages/x/package.json': { a: '^2.0.0', b: '1.0.0' },
        })
      )
    ).toBe(3)
    expect(
      tool('taze').count(
        JSON.stringify({
          packages: [
            { resolved: [{ update: true }, { update: false }] },
            { resolved: [{ update: true }] },
          ],
        })
      )
    ).toBe(2)
    expect(tool('npm-check').count('table')).toBeNull()
    // npm lists a package once, or once per workspace as an array; pnpm keys by package.
    expect(tool('pm').count(JSON.stringify({ a: {}, b: [{}, {}] }))).toBe(3)
  })

  it('fails loudly on output it cannot read', () => {
    expect(() => tool('inup').count('Error: something broke')).toThrow()
    expect(() => tool('taze').count('{}')).toThrow()
  })
})

describe('sandbox', () => {
  it('points home, the XDG folders and the temp folder into the box', () => {
    const box = join('/bench', 'box')
    expect(sandboxEnv(box)).toEqual({
      HOME: box,
      XDG_CONFIG_HOME: join(box, '.config'),
      XDG_CACHE_HOME: join(box, '.cache'),
      XDG_DATA_HOME: join(box, '.local', 'share'),
      XDG_STATE_HOME: join(box, '.local', 'state'),
      TMPDIR: join(box, 'tmp'),
    })
  })

  it('quotes for a POSIX shell', () => {
    expect(quote('/a b/cli.js')).toBe("'/a b/cli.js'")
    expect(quote("it's")).toBe("'it'\\''s'")
  })

  it('prefixes the command with the sandbox and quotes every argument', () => {
    const command = shellCommand(['node', '/a b/cli.js', '--json'], '/box')
    expect(command).toMatch(/^HOME='\/box' /)
    expect(command.endsWith(`'node' '/a b/cli.js' '--json'`)).toBe(true)
    expect(command).not.toContain('||')
  })

  it.skipIf(process.platform === 'win32')('lets exit code 1 through only when asked', () => {
    const box = mkdtempSync(join(tmpdir(), 'inup-bench-box-'))
    try {
      const status = (code: number, failsWhenOutdated: boolean) =>
        spawnSync('sh', [
          '-c',
          shellCommand(['sh', '-c', `exit ${code}`], box, { failsWhenOutdated }),
        ]).status
      expect(status(0, false)).toBe(0)
      expect(status(1, false)).toBe(1)
      expect(status(1, true)).toBe(0)
      expect(status(2, true)).not.toBe(0)
    } finally {
      rmSync(box, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('runs the command with the sandbox environment', () => {
    const box = mkdtempSync(join(tmpdir(), 'inup-bench-box-'))
    try {
      const printed = spawnSync(
        'sh',
        ['-c', shellCommand(['sh', '-c', 'printf "%s|%s" "$HOME" "$TMPDIR"'], box)],
        { encoding: 'utf8' }
      ).stdout
      expect(printed).toBe(`${box}|${join(box, 'tmp')}`)
    } finally {
      rmSync(box, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('empties the box and recreates its temp folder', () => {
    const box = mkdtempSync(join(tmpdir(), 'inup-bench-box-'))
    try {
      writeFileSync(join(box, 'cache.json'), '{}')
      expect(spawnSync('sh', ['-c', resetBoxCommand(box)]).status).toBe(0)
      expect(spawnSync('ls', ['-A', box], { encoding: 'utf8' }).stdout.trim()).toBe('tmp')
    } finally {
      rmSync(box, { recursive: true, force: true })
    }
  })
})

describe('countManifests', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const write = (path: string, pkg: object) => {
    mkdirSync(join(dir, path), { recursive: true })
    writeFileSync(join(dir, path, 'package.json'), JSON.stringify(pkg))
  }

  it('counts package.json files and the registry dependencies they name', () => {
    dir = mkdtempSync(join(tmpdir(), 'inup-bench-manifests-'))
    write('.', { devDependencies: { typescript: '^5.0.0', vitest: '^4.0.0' } })
    write('packages/a', {
      dependencies: { react: '^19.0.0', b: 'workspace:*' },
      peerDependencies: { react: '>=18' },
    })
    write('packages/b', {
      dependencies: { local: 'file:../local', linked: 'link:../x', yaml: 'catalog:' },
    })
    write('node_modules/react', { dependencies: { 'loose-envify': '^1.0.0' } })
    write('.cache/thing', { dependencies: { hidden: '^1.0.0' } })
    expect(countManifests(dir)).toEqual({ manifests: 3, dependencies: 4 })
  })
})
