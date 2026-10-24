import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawnSync: spawnSyncMock }
})

import {
  globalAddCommand,
  listGlobalPackages,
  parseGlobalPackages,
  writeGlobalManifest,
} from '../../../src/shared/global-packages'

describe('parseGlobalPackages', () => {
  it('reads npm', () => {
    const output = JSON.stringify({
      dependencies: {
        typescript: { version: '5.4.5' },
        // `npm link`: no registry version to compare.
        'my-tool': { version: 'file:../my-tool' },
        broken: {},
      },
    })
    expect(parseGlobalPackages('npm', output)).toEqual({ typescript: '5.4.5' })
  })

  it('reads pnpm, including a global dir with nothing installed', () => {
    const output = JSON.stringify([
      { path: '/a', dependencies: { '@scope/cli': { version: '1.0.0' } } },
      { path: '/b' },
    ])
    expect(parseGlobalPackages('pnpm', output)).toEqual({ '@scope/cli': '1.0.0' })
  })

  it('reads bun', () => {
    const output = [
      '/home/u/.bun/install/global node_modules (2)',
      '├── @scope/cli@1.0.0',
      '└── typescript@5.4.5',
    ].join('\n')
    expect(parseGlobalPackages('bun', output)).toEqual({
      '@scope/cli': '1.0.0',
      typescript: '5.4.5',
    })
  })
})

describe('globalAddCommand', () => {
  it("uses each package manager's global install", () => {
    expect(globalAddCommand('npm', ['a@1.0.0', 'b@2.0.0'])).toBe('npm install -g a@1.0.0 b@2.0.0')
    expect(globalAddCommand('pnpm', ['a@1.0.0'])).toBe('pnpm add -g a@1.0.0')
    expect(globalAddCommand('bun', ['a@1.0.0'])).toBe('bun add -g a@1.0.0')
  })

  it('refuses Yarn, which has no global installs to list', () => {
    expect(() => globalAddCommand('yarn', [])).toThrow(
      "inup can't upgrade yarn global packages: use -g with npm, pnpm or bun."
    )
  })
})

describe('listGlobalPackages', () => {
  afterEach(() => {
    spawnSyncMock.mockReset()
  })

  it('keeps the listing npm prints when it exits 1 over a problem', () => {
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: JSON.stringify({ dependencies: { zx: { version: '8.0.0' } } }),
    })
    expect(listGlobalPackages('npm')).toEqual({ zx: '8.0.0' })
    expect(spawnSyncMock).toHaveBeenCalledWith('npm ls -g --depth=0 --json', {
      encoding: 'utf-8',
      shell: true,
    })
  })

  it.each([
    [{ error: new Error('spawn ENOENT') }, 'spawn ENOENT'],
    [{ status: 1, stdout: '', stderr: 'pnpm: not configured\n' }, 'pnpm: not configured'],
    [{ status: 127, stdout: '  ' }, 'exit code 127'],
  ])('says why when there is no listing', (result, reason) => {
    spawnSyncMock.mockReturnValue(result)
    expect(() => listGlobalPackages('pnpm')).toThrow(
      `Could not list global packages with \`pnpm ls -g --depth=0 --json\`: ${reason}`
    )
  })
})

describe('writeGlobalManifest', () => {
  it('declares each package at ^installed in a manifest removed on exit', () => {
    const once = vi.spyOn(process, 'once')
    const dir = writeGlobalManifest({ typescript: '5.4.5' })

    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))).toEqual({
      name: 'global-packages',
      private: true,
      dependencies: { typescript: '^5.4.5' },
    })
    const [event, cleanup] = once.mock.calls[0] as [string, () => void]
    expect(event).toBe('exit')
    cleanup()
    expect(existsSync(dir)).toBe(false)
    once.mockRestore()
  })
})
