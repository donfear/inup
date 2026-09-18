import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeCommand, executeCommandAsync } from '../../../src/shared/exec'

describe('exec utils', () => {
  describe('executeCommand()', () => {
    it('should execute a simple command successfully', () => {
      const result = executeCommand('node -e "console.log(\'hello\')"')
      expect(result.trim()).toBe('hello')
    })

    it('should execute command with cwd option', () => {
      const tmpDir = os.tmpdir()
      // On macOS, /var/folders/... is a symlink → realpath gives the /private/var/... path
      // that process.cwd() actually returns in the child process
      const realTmpDir = fs.realpathSync(tmpDir)

      const result = executeCommand('node -e "console.log(process.cwd())"', tmpDir)
      expect(result.trim()).toBe(realTmpDir)
    })

    it('should throw error for invalid command', () => {
      expect(() => executeCommand('nonexistent-command-xyz')).toThrow('Command failed')
    })

    it('should return output from successful command', () => {
      const result = executeCommand('node --version')
      expect(result).toMatch(/^v\d+\.\d+\.\d+/)
    })

    it('should handle commands with pipes', () => {
      const result = executeCommand('node -e "console.log(\'test\')" | cat')
      expect(result.trim()).toBe('test')
    })
  })

  describe('executeCommandAsync()', () => {
    it('should execute a simple command asynchronously', async () => {
      const result = await executeCommandAsync('node -e "console.log(\'hello async\')"')
      expect(result.trim()).toBe('hello async')
    })

    it('should reject for invalid command', async () => {
      await expect(executeCommandAsync('nonexistent-command-xyz')).rejects.toThrow('Command failed')
    })

    it('should return output from successful command', async () => {
      const result = await executeCommandAsync('node --version')
      expect(result).toMatch(/^v\d+\.\d+\.\d+/)
    })

    it('should handle multiple async commands', async () => {
      const results = await Promise.all([
        executeCommandAsync('node -e "console.log(\'test1\')"'),
        executeCommandAsync('node -e "console.log(\'test2\')"'),
        executeCommandAsync('node -e "console.log(\'test3\')"'),
      ])

      expect(results[0].trim()).toBe('test1')
      expect(results[1].trim()).toBe('test2')
      expect(results[2].trim()).toBe('test3')
    })
  })
})
describe('exec cross-platform robustness', () => {
  let scratchDir: string

  beforeEach(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inup-exec-test-'))
  })

  afterEach(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true })
  })

  it('runs with a cwd containing spaces (common under C:\\Users\\First Last)', () => {
    const spaced = path.join(scratchDir, 'dir with spaces')
    fs.mkdirSync(spaced)
    const real = fs.realpathSync(spaced)

    const result = executeCommand('node -e "console.log(process.cwd())"', spaced)
    expect(result.trim()).toBe(real)
  })

  it('runs with a cwd containing non-ASCII characters', () => {
    const unicodeDir = path.join(scratchDir, 'пакет-höhe-日本')
    fs.mkdirSync(unicodeDir)
    const real = fs.realpathSync(unicodeDir)

    const result = executeCommand('node -e "console.log(process.cwd())"', unicodeDir)
    expect(result.trim()).toBe(real)
  })

  it('round-trips non-ASCII output as UTF-8 regardless of the console codepage', () => {
    const result = executeCommand(
      'node -e "console.log(Buffer.from([0xE6, 0x97, 0xA5, 0xF0, 0x9F, 0x9A, 0x80]).toString())"'
    )
    expect(result.trim()).toBe('日🚀')
  })

  it('emits LF-only multi-line output from a piped child on every platform', () => {
    // stdio is a pipe, not a console, so even Windows children write \n — code that
    // splits command output on '\n' relies on this holding everywhere.
    const result = executeCommand(`node -e "console.log('one'); console.log('two')"`)
    expect(result).toBe('one\ntwo\n')
    expect(result.includes('\r')).toBe(false)
  })

  it('fails loudly instead of truncating when output exceeds the 1MB maxBuffer default', () => {
    expect(() =>
      executeCommand(`node -e "process.stdout.write('x'.repeat(2 * 1024 * 1024))"`)
    ).toThrow('Command failed')
  })

  it('includes the failing command in the sync error for diagnosability', () => {
    expect(() => executeCommand('node -e "process.exit(3)"')).toThrow(
      'Command failed: node -e "process.exit(3)"'
    )
  })

  it('throws for a command that exits non-zero even when it wrote to stdout first', () => {
    expect(() => executeCommand(`node -e "console.log('partial'); process.exit(1)"`)).toThrow(
      'Command failed'
    )
  })

  it('rejects with the failing command in the async error too', async () => {
    await expect(executeCommandAsync('node -e "process.exit(7)"')).rejects.toThrow(
      'Command failed: node -e "process.exit(7)"'
    )
  })
})

describe('executeCommandAsync stderr handling', () => {
  it('rejects when a command produces only stderr output', async () => {
    await expect(executeCommandAsync(`node -e "console.error('boom')"`)).rejects.toThrow(
      'Command failed'
    )
  })

  it('tolerates stderr noise when stdout has content', async () => {
    const output = await executeCommandAsync(`node -e "console.error('warn'); console.log('ok')"`)
    expect(output.trim()).toBe('ok')
  })
})
