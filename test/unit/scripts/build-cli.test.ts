import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BUNDLE_FILE, bundleCli, LAUNCHER } from '../../../scripts/build-cli.mjs'
import { PACKAGE_VERSION } from '../../../src/shared/config'

/**
 * The published CLI: dist/cli.js launches one bundled file. Built outside the
 * repository, so a dependency the bundle failed to take in cannot be found in
 * node_modules and fails the run instead of passing by accident.
 */
describe('bundled CLI', () => {
  let outdir = ''
  let launcher = ''

  beforeAll(async () => {
    outdir = mkdtempSync(join(tmpdir(), 'inup-bundle-'))
    launcher = await bundleCli({ outdir })
  }, 60_000)

  afterAll(() => {
    rmSync(outdir, { recursive: true, force: true })
  })

  // Caches and config go to the temp dir, not the real home folder.
  const run = (...args: string[]) =>
    execFileSync(process.execPath, [launcher, ...args], {
      cwd: outdir,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: outdir,
        XDG_CACHE_HOME: outdir,
        XDG_CONFIG_HOME: outdir,
        LOCALAPPDATA: outdir,
        APPDATA: outdir,
        NO_COLOR: '1',
      },
    })

  it('writes the launcher as cli.js, starting the bundle next to it', () => {
    expect(launcher).toBe(join(outdir, 'cli.js'))
    expect(readFileSync(launcher, 'utf8')).toBe(LAUNCHER)
    expect(LAUNCHER.startsWith('#!/usr/bin/env node\n')).toBe(true)
    expect(LAUNCHER).toContain(`require('./${BUNDLE_FILE}').program.parse()`)
    if (process.platform !== 'win32') {
      expect(statSync(launcher).mode & 0o111).toBe(0o111)
    }
  })

  it('turns the compile cache on before the bundle loads', () => {
    expect(LAUNCHER.indexOf('enableCompileCache')).toBeLessThan(LAUNCHER.indexOf(BUNDLE_FILE))
  })

  // Covers the paths a run below cannot reach, like the interactive picker.
  it('requires nothing but Node built-ins at runtime', () => {
    const bundle = readFileSync(join(outdir, BUNDLE_FILE), 'utf8')
    const required = [...bundle.matchAll(/\brequire\("([^"]+)"\)/g)].map(([, id]) => id)
    expect(required).toContain('node:fs')
    expect(required.filter((id) => !isBuiltin(id))).toEqual([])
  })

  it('runs without the repository node_modules', { timeout: 30_000 }, () => {
    expect(run('--version').trim()).toBe(PACKAGE_VERSION)
  })

  it('loads the headless runner from the bundle on demand', { timeout: 30_000 }, () => {
    const project = join(outdir, 'project')
    mkdirSync(project)
    writeFileSync(join(project, 'package.json'), '{ "name": "empty", "version": "1.0.0" }\n')
    const report = JSON.parse(run('--json', '--no-native', '--dir', project))
    expect(report.summary.total).toBe(0)
  })
})
