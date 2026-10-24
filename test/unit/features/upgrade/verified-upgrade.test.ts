import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawnSync: spawnSyncMock }
})

import type { PackageUpgrader } from '../../../../src/features/upgrade/upgrader'
import { VerifiedUpgrade } from '../../../../src/features/upgrade/verified-upgrade'
import type { PackageUpgradeChoice } from '../../../../src/shared/types'

describe('VerifiedUpgrade', () => {
  let dir: string
  let manifest: string
  let lockfile: string
  let installed: Set<string>
  let upgrader: {
    upgradePackages: ReturnType<typeof vi.fn>
    reinstall: ReturnType<typeof vi.fn>
    filesWrittenBy: ReturnType<typeof vi.fn>
  }
  /** Names whose upgrade makes the verify command fail. */
  let breaking: Set<string>
  let log: ReturnType<typeof vi.spyOn>

  const choice = (name: string, packageJsonPath = manifest): PackageUpgradeChoice => ({
    name,
    packageJsonPath,
    dependencyType: 'dependencies',
    upgradeType: 'latest',
    targetVersion: '^2.0.0',
    currentVersionSpecifier: '^1.0.0',
  })

  const verified = (quiet?: boolean) =>
    new VerifiedUpgrade(upgrader as unknown as PackageUpgrader, {
      command: 'npm test',
      cwd: dir,
      quiet,
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'inup-verify-'))
    manifest = join(dir, 'package.json')
    lockfile = join(dir, 'package-lock.json')
    writeFileSync(manifest, 'before')
    writeFileSync(lockfile, 'lock before')
    installed = new Set()
    breaking = new Set()
    upgrader = {
      // Stands in for the real write + install: marks the packages installed and edits the files.
      upgradePackages: vi.fn(async (choices: PackageUpgradeChoice[]) => {
        for (const { name } of choices) installed.add(name)
        writeFileSync(manifest, `after ${[...installed].join(',')}`)
        writeFileSync(lockfile, 'lock after')
      }),
      reinstall: vi.fn(async () => {
        installed = new Set(
          readFileSync(manifest, 'utf-8')
            .replace(/^(before|after ?)/, '')
            .split(',')
            .filter(Boolean)
        )
      }),
      filesWrittenBy: vi.fn((choices: PackageUpgradeChoice[]) => [
        ...new Set([...choices.map((c) => c.packageJsonPath), lockfile]),
      ]),
    }
    spawnSyncMock.mockReset().mockImplementation(() => ({
      status: [...installed].some((name) => breaking.has(name)) ? 1 : 0,
    }))
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    log.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps everything when the command passes with every upgrade', async () => {
    const result = await verified().run([choice('a'), choice('b')])

    expect(result).toEqual({ kept: ['a', 'b'], reverted: [] })
    expect(upgrader.upgradePackages).toHaveBeenCalledTimes(1)
    expect(spawnSyncMock).toHaveBeenCalledTimes(2)
    expect(spawnSyncMock).toHaveBeenCalledWith('npm test', {
      cwd: dir,
      stdio: 'inherit',
      shell: true,
    })
    expect(readFileSync(manifest, 'utf-8')).toBe('after a,b')
  })

  it('retries one package at a time and reverts the ones that break it', async () => {
    breaking.add('b')

    const result = await verified().run([choice('a'), choice('b'), choice('c')])

    expect(result).toEqual({ kept: ['a', 'c'], reverted: ['b'] })
    expect(readFileSync(manifest, 'utf-8')).toBe('after a,c')
    expect(readFileSync(lockfile, 'utf-8')).toBe('lock after')
    const lines = log.mock.calls.map(([line]) => String(line))
    expect(
      lines.some((line) => line.includes('Kept 2 upgrade(s) that pass `npm test`: a, c'))
    ).toBe(true)
    expect(lines.some((line) => line.includes('Reverted 1 that fail it: b'))).toBe(true)
  })

  it('retries a package in every manifest that declares it at once', async () => {
    const nested = join(dir, 'packages', 'x', 'package.json')
    mkdirSync(join(dir, 'packages', 'x'), { recursive: true })
    writeFileSync(nested, 'nested')
    breaking.add('b')

    const result = await verified().run([choice('a'), choice('b'), choice('a', nested)])

    expect(result).toEqual({ kept: ['a'], reverted: ['b'] })
    expect(upgrader.upgradePackages.mock.calls.map(([choices]) => choices)).toEqual([
      [choice('a'), choice('b'), choice('a', nested)],
      [choice('a'), choice('a', nested)],
      [choice('b')],
    ])
  })

  it('reverts a single package without retrying it, and removes a lockfile that was not there', async () => {
    rmSync(lockfile)
    breaking.add('a')

    const result = await verified().run([choice('a')])

    expect(result).toEqual({ kept: [], reverted: ['a'] })
    expect(upgrader.upgradePackages).toHaveBeenCalledTimes(1)
    expect(spawnSyncMock).toHaveBeenCalledTimes(2)
    expect(upgrader.reinstall).toHaveBeenCalledWith([choice('a')])
    expect(existsSync(lockfile)).toBe(false)
    expect(readFileSync(manifest, 'utf-8')).toBe('before')
    const lines = log.mock.calls.map(([line]) => String(line))
    expect(lines.some((line) => line.includes('Retrying'))).toBe(false)
    expect(lines.some((line) => line.includes('Kept 0 upgrade(s) that pass `npm test`'))).toBe(true)
    expect(lines.some((line) => line.includes('Reverted 1 that fail it: a'))).toBe(true)
  })

  it('treats an upgrade whose install fails as one that breaks it', async () => {
    upgrader.upgradePackages.mockImplementation(async (choices: PackageUpgradeChoice[]) => {
      writeFileSync(manifest, 'half-written')
      if (choices.some(({ name }) => name === 'b')) throw new Error('install exited 1')
      for (const { name } of choices) installed.add(name)
      writeFileSync(manifest, `after ${[...installed].join(',')}`)
    })

    const result = await verified().run([choice('a'), choice('b')])

    expect(result).toEqual({ kept: ['a'], reverted: ['b'] })
    expect(readFileSync(manifest, 'utf-8')).toBe('after a')
    expect(
      log.mock.calls.some(([line]) =>
        String(line).includes('Upgrade failed with b upgraded: install exited 1')
      )
    ).toBe(true)
  })

  it('refuses to start when the command already fails', async () => {
    spawnSyncMock.mockReturnValue({ status: 1 })

    await expect(verified().run([choice('a')])).rejects.toThrow(
      "`npm test` fails before upgrading anything, so inup can't tell which upgrade breaks it. Make it pass first, or skip it with --no-verify."
    )
    expect(upgrader.upgradePackages).not.toHaveBeenCalled()
  })

  it('keeps stdout for --json in quiet mode', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await verified(true).run([choice('a')])

    expect(spawnSyncMock).toHaveBeenCalledWith('npm test', {
      cwd: dir,
      stdio: ['inherit', 2, 'inherit'],
      shell: true,
    })
    expect(log).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
