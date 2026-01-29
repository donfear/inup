import { describe, it, expect } from 'vitest'
import { executeCommand, executeCommandAsync } from '../../../src/utils/exec'

describe('exec utils', () => {
  describe('executeCommand()', () => {
    it('should execute a simple command successfully', () => {
      const result = executeCommand('node -e "console.log(\'hello\')"')
      expect(result.trim()).toBe('hello')
    })

    it('should execute command with cwd option', () => {
      const result = executeCommand('node -e "console.log(process.cwd())"', '/tmp')
      expect(result.trim()).toMatch(/tmp/)
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
      await expect(executeCommandAsync('nonexistent-command-xyz')).rejects.toThrow(
        'Command failed'
      )
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
