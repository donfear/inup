import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  countManifests,
  FIXTURES,
  inspectFixture,
  pickerEnv,
  quote,
  resetBoxCommand,
  sandboxEnv,
  shellCommand,
  summarize,
  TOOLS,
  timePicker,
} from '../../../scripts/bench-compare.mjs'

const tool = (id: string) => {
  const found = TOOLS.find((candidate: { id: string }) => candidate.id === id)
  if (!found) throw new Error(`no tool ${id}`)
  return found
}

const single = { pm: 'npm', workspaces: false }
const npmWorkspace = { pm: 'npm', workspaces: true }
const pnpmWorkspace = { pm: 'pnpm', workspaces: true }
const bunWorkspace = { pm: 'bun', workspaces: true }
const yarnWorkspace = { pm: 'yarn', workspaces: true }

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
    expect(tool('syncpack').args(pnpmWorkspace)).toEqual(['update', '--check'])
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
    expect(pm.name(bunWorkspace)).toBe('bun outdated')
    expect(pm.args(bunWorkspace)).toEqual(['outdated', '--recursive'])
    expect(pm.args({ pm: 'bun', workspaces: false })).toEqual(['outdated'])
    expect(pm.unsupported(bunWorkspace)).toBeNull()
  })

  it('has no package-manager row for Yarn 2+, whose only update list is its picker', () => {
    expect(tool('pm').name(yarnWorkspace)).toBe('yarn upgrade-interactive')
    expect(tool('pm').unsupported(yarnWorkspace)).toMatch(/interactive picker/)
  })

  it('skips npm-check on workspaces only', () => {
    expect(tool('npm-check').unsupported(single)).toBeNull()
    expect(tool('npm-check').unsupported(pnpmWorkspace)).toBe('no workspace support')
  })

  it('accepts exit code 1 only from the tools that use it for "found updates"', () => {
    const failing = TOOLS.filter(
      (candidate: { failsWhenOutdated?: boolean }) => candidate.failsWhenOutdated
    )
    expect(failing.map((candidate: { id: string }) => candidate.id)).toEqual([
      'syncpack',
      'npm-check',
      'pm',
    ])
  })

  const out = (stdout: string) => ({ stdout, stderr: '' })

  it('counts the updates in each report', () => {
    expect(tool('inup').count(out(JSON.stringify({ summary: { outdated: 22 } })))).toBe(22)
    expect(tool('ncu').count(out(JSON.stringify({ a: '^2.0.0', b: '^3.0.0' })))).toBe(2)
    expect(
      tool('ncu').count(
        out(
          JSON.stringify({
            'package.json': { a: '^2.0.0' },
            'packages/x/package.json': { a: '^2.0.0', b: '1.0.0' },
          })
        )
      )
    ).toBe(3)
    expect(
      tool('taze').count(
        out(
          JSON.stringify({
            packages: [
              { resolved: [{ update: true }, { update: false }] },
              { resolved: [{ update: true }] },
            ],
          })
        )
      )
    ).toBe(2)
    expect(tool('npm-check').count(out('table'))).toBeNull()
    // npm lists a package once, or once per workspace as an array; pnpm keys by package.
    expect(tool('pm').count(out(JSON.stringify({ a: {}, b: [{}, {}] })), single)).toBe(3)
  })

  it('counts the lines syncpack writes to stderr', () => {
    const stderr = [
      '= Catalog Definitions ==========================================',
      '   1x @babel/parser ^7.29.9 (~1mo) → ^8.0.7 (~14d)',
      '= Default Version Group ========================================',
      '   3x react ^18.3.1 (~1.9y) → ^19.2.0 (~3mo)',
      '',
    ].join('\n')
    expect(tool('syncpack').count({ stdout: '', stderr })).toBe(2)
  })

  it("counts the rows of bun's table", () => {
    const stdout = [
      'bun outdated v1.3.5 (1e86cebd)',
      '|----------------------------------------------|',
      '| Package           | Current | Update | Latest | Workspace |',
      '|----------------------------------------------|',
      '| @types/nodemailer | 8.0.1   | 8.0.2  | 8.0.2  | vendure   |',
      '|----------------------------------------------|',
      '| typescript (dev)  | 5.9.3   | 5.9.3  | 6.0.3  | core      |',
      '|----------------------------------------------|',
    ].join('\n')
    expect(tool('pm').count(out(stdout), bunWorkspace)).toBe(2)
    expect(tool('pm').count(out('bun outdated v1.3.5\n'), bunWorkspace)).toBe(0)
  })

  it('fails loudly on output it cannot read', () => {
    expect(() => tool('inup').count(out('Error: something broke'))).toThrow()
    expect(() => tool('taze').count(out('{}'))).toThrow()
  })
})

describe('pickers', () => {
  const picker = (id: string) => tool(id).picker
  const npmSingle = { pm: 'npm', workspaces: false }

  it('opens each interactive list, every update included', () => {
    expect(picker('inup').args(pnpmWorkspace)).toEqual([])
    expect(picker('ncu').args(single)).toEqual(['--interactive'])
    expect(picker('taze').args(pnpmWorkspace)).toEqual([
      'major',
      '--interactive',
      '--recursive',
      '--include-locked',
      '--no-github-actions',
      '--no-node-version',
    ])
    expect(picker('syncpack').args(pnpmWorkspace)).toEqual(['update', '--interactive'])
    expect(picker('npm-check').args(single)).toEqual(['--update', '--skip-unused'])
  })

  it("opens the package manager's own picker", () => {
    const pm = picker('pm')
    expect(pm.name(yarnWorkspace)).toBe('yarn upgrade-interactive')
    expect(pm.args(yarnWorkspace)).toEqual(['upgrade-interactive'])
    expect(pm.name(pnpmWorkspace)).toBe('pnpm update -i')
    expect(pm.args(pnpmWorkspace)).toEqual(['update', '--interactive', '--latest', '--recursive'])
    expect(pm.args(bunWorkspace)).toEqual(['update', '--interactive', '--recursive'])
    expect(pm.unsupported(npmSingle)).toBe('npm has no interactive update')
    expect(pm.unsupported(yarnWorkspace)).toBeNull()
  })

  it('skips pickers that cannot show a whole workspace at once', () => {
    expect(picker('ncu').unsupported(pnpmWorkspace)).toBe('asks about one package.json at a time')
    expect(picker('ncu').unsupported(single)).toBeNull()
    expect(picker('npm-check').unsupported(pnpmWorkspace)).toBe('no workspace support')
  })

  it('runs them sandboxed, in a color terminal, outside CI', () => {
    const env = pickerEnv('/box', {
      PATH: '/bin',
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      CONTINUOUS_INTEGRATION: '1',
    })
    expect(env).toMatchObject({ PATH: '/bin', HOME: '/box', TERM: 'xterm-256color' })
    expect(env).not.toHaveProperty('CI')
    expect(env).not.toHaveProperty('GITHUB_ACTIONS')
    expect(env).not.toHaveProperty('CONTINUOUS_INTEGRATION')
  })
})

describe('summarize', () => {
  it('reports what hyperfine reports', () => {
    expect(summarize([3, 1, 2])).toEqual({
      median: 2,
      mean: 2,
      stddev: 1,
      min: 1,
      max: 3,
      times: [3, 1, 2],
    })
    expect(summarize([4, 1, 2, 3]).median).toBe(2.5)
    expect(summarize([5]).stddev).toBe(0)
  })
})

describe.skipIf(process.platform === 'win32')('timePicker', () => {
  let box = ''
  afterEach(() => rmSync(box, { recursive: true, force: true }))
  const start = (script: string, options: { idleMs?: number; limitMs?: number } = {}) => {
    box = mkdtempSync(join(tmpdir(), 'inup-bench-picker-'))
    return timePicker(['sh', '-c', script], { cwd: box, box, idleMs: 300, ...options })
  }

  it('times a picker until it goes quiet, in a terminal', async () => {
    const seconds = await start('[ -t 1 ] && printf ready; sleep 30')
    expect(seconds).toBeGreaterThanOrEqual(0)
    expect(seconds).toBeLessThan(2)
  })

  it('counts cache writes after the last thing drawn', async () => {
    const seconds = await start('printf ready; sleep 0.5; touch "$HOME/fetched"; sleep 30', {
      idleMs: 1000,
    })
    expect(seconds).toBeGreaterThanOrEqual(0.45)
  })

  it('stops the picker once timed', async () => {
    await start('echo $$ > "$HOME/pid"; printf ready; sleep 30')
    const pid = Number(readFileSync(join(box, 'pid'), 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  })

  it('fails a picker that exits instead of waiting', async () => {
    await expect(start('printf oops; exit 3')).rejects.toThrow('exited (3) instead of waiting')
  })

  it('fails a picker that draws nothing', async () => {
    await expect(start('sleep 30', { limitMs: 800 })).rejects.toThrow('drew nothing in 0.8 s')
  })

  // On a slow machine python and the terminal can take longer to start than the idle window.
  it('waits for the first thing drawn, however long the start takes', async () => {
    const seconds = await start('sleep 0.6; printf ready; sleep 30', { idleMs: 200 })
    expect(seconds).toBeGreaterThanOrEqual(0.6)
  })

  it('fails a picker that never goes quiet', async () => {
    await expect(
      start('while true; do printf x; sleep 0.05; done', { limitMs: 800 })
    ).rejects.toThrow('still busy')
  })
})

describe('inspectFixture', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const fixture = (pkg: object, ...files: string[]) => {
    dir = mkdtempSync(join(tmpdir(), 'inup-bench-fixture-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
    for (const file of files) writeFileSync(join(dir, file), '')
    return inspectFixture(dir)
  }

  it('reads the package manager and version from packageManager', () => {
    expect(fixture({ packageManager: 'pnpm@12.11.2+sha512.abc' }, 'pnpm-workspace.yaml')).toEqual({
      pm: 'pnpm',
      pmVersion: '12.11.2',
      workspaces: true,
    })
    expect(fixture({ packageManager: 'yarn@4.18.0', workspaces: ['packages/*'] })).toEqual({
      pm: 'yarn',
      pmVersion: '4.18.0',
      workspaces: true,
    })
  })

  it('falls back to the lockfile, then npm', () => {
    expect(fixture({ workspaces: ['packages/*'] }, 'bun.lock')).toEqual({
      pm: 'bun',
      pmVersion: null,
      workspaces: true,
    })
    expect(fixture({}, 'bun.lockb').pm).toBe('bun')
    expect(fixture({})).toEqual({ pm: 'npm', pmVersion: null, workspaces: false })
  })

  it('refuses what it cannot run', () => {
    expect(() => fixture({ packageManager: 'yarn@1.22.22' })).toThrow('Yarn 2+')
    expect(() => fixture({}, 'yarn.lock')).toThrow('Yarn 2+')
    expect(() => fixture({ packageManager: 'deno@2.0.0' })).toThrow('unsupported')
  })
})

describe('sandbox', () => {
  it('points home, the XDG folders, the temp folder and every known cache into the box', () => {
    const box = join('/bench', 'box')
    expect(sandboxEnv(box)).toEqual({
      HOME: box,
      XDG_CONFIG_HOME: join(box, '.config'),
      XDG_CACHE_HOME: join(box, '.cache'),
      XDG_DATA_HOME: join(box, '.local', 'share'),
      XDG_STATE_HOME: join(box, '.local', 'state'),
      TMPDIR: join(box, 'tmp'),
      npm_config_cache: join(box, '.npm'),
      BUN_INSTALL: join(box, '.bun'),
      BUN_INSTALL_CACHE_DIR: join(box, '.bun', 'install', 'cache'),
      YARN_GLOBAL_FOLDER: join(box, '.yarn', 'berry'),
    })
    for (const path of Object.values(sandboxEnv(box))) expect(path.startsWith(box)).toBe(true)
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
