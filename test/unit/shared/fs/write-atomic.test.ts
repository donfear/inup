import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileAtomic } from '../../../../src/shared/fs'
import { diskFull } from '../../../helpers/disk-full'

// Real fs, except a test can arm the next writeFileSync to fail halfway like a full disk.
vi.mock('node:fs', async (importOriginal) => {
  const { withDiskFull } = await import('../../../helpers/disk-full')
  return withDiskFull(await importOriginal())
})

describe('writeFileAtomic', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'inup-write-atomic-test-'))
  })

  afterEach(() => {
    diskFull.armed = false
    rmSync(testDir, { recursive: true, force: true })
  })

  it('replaces the contents of an existing file and leaves no temp file behind', () => {
    const path = join(testDir, 'package.json')
    writeFileSync(path, '{ "old": true }\n')

    writeFileAtomic(path, '{ "new": true }\n')

    expect(readFileSync(path, 'utf8')).toBe('{ "new": true }\n')
    expect(readdirSync(testDir)).toEqual(['package.json'])
  })

  it('creates the file when it does not exist yet', () => {
    const path = join(testDir, 'config.json')

    writeFileAtomic(path, '{}')

    expect(readFileSync(path, 'utf8')).toBe('{}')
    expect(readdirSync(testDir)).toEqual(['config.json'])
  })

  it("keeps the original file's permission bits", () => {
    const path = join(testDir, 'package.json')
    writeFileSync(path, 'old')
    // Not what a fresh file gets under the usual umask, so a lost mode would show.
    chmodSync(path, 0o600)
    const before = statSync(path).mode

    writeFileAtomic(path, 'new')

    expect(statSync(path).mode).toBe(before)
  })

  // Windows has no POSIX write bits, and root passes the W_OK check regardless of mode.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'refuses a read-only file instead of replacing it',
    () => {
      const path = join(testDir, 'package.json')
      writeFileSync(path, 'original')
      chmodSync(path, 0o444)

      expect(() => writeFileAtomic(path, 'new')).toThrow(
        expect.objectContaining({ code: 'EACCES' })
      )

      expect(readFileSync(path, 'utf8')).toBe('original')
      expect(statSync(path).mode & 0o777).toBe(0o444)
      expect(readdirSync(testDir)).toEqual(['package.json'])
    }
  )

  it('writes through a symlink instead of replacing the link with a plain file', () => {
    const real = join(testDir, 'real.yaml')
    const link = join(testDir, 'pnpm-workspace.yaml')
    writeFileSync(real, 'old')
    symlinkSync(real, link, 'file')

    writeFileAtomic(link, 'new')

    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readFileSync(real, 'utf8')).toBe('new')
    expect(readdirSync(testDir).sort()).toEqual(['pnpm-workspace.yaml', 'real.yaml'])
  })

  it('leaves the original intact and removes the temp file when the disk fills up mid-write', () => {
    const path = join(testDir, 'package.json')
    writeFileSync(path, 'original')

    diskFull.armed = true
    expect(() => writeFileAtomic(path, 'a much longer replacement')).toThrow('ENOSPC')

    expect(readFileSync(path, 'utf8')).toBe('original')
    expect(readdirSync(testDir)).toEqual(['package.json'])
  })

  it('removes the temp file when the final rename fails', () => {
    // A directory can't be replaced by a file, so the rename is what fails here.
    const path = join(testDir, 'package.json')
    mkdirSync(path)

    expect(() => writeFileAtomic(path, 'content')).toThrow()

    expect(statSync(path).isDirectory()).toBe(true)
    expect(readdirSync(testDir)).toEqual(['package.json'])
  })
})
