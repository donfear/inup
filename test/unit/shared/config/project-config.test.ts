import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isPackageIgnored, loadProjectConfig } from '../../../../src/shared/config/project-config'

describe('project-config', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `inup-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('loadProjectConfig()', () => {
    it('should return empty config when no config file exists', () => {
      const config = loadProjectConfig(testDir)
      expect(config).toEqual({})
    })

    it('should load config from .inuprc', () => {
      const configContent = {
        ignore: ['lodash', 'moment'],
      }
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify(configContent))

      const config = loadProjectConfig(testDir)
      expect(config.ignore).toEqual(['lodash', 'moment'])
    })

    it('drops a non-array ignore field', () => {
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ ignore: 'react' }))

      const config = loadProjectConfig(testDir)
      expect(config.ignore).toBeUndefined()
    })

    it('should load config from .inuprc.json', () => {
      const configContent = {
        ignore: ['react', 'react-dom'],
      }
      writeFileSync(join(testDir, '.inuprc.json'), JSON.stringify(configContent))

      const config = loadProjectConfig(testDir)
      expect(config.ignore).toEqual(['react', 'react-dom'])
    })

    it('should load config from inup.config.json', () => {
      const configContent = {
        ignore: ['typescript'],
        exclude: ['dist', 'node_modules'],
      }
      writeFileSync(join(testDir, 'inup.config.json'), JSON.stringify(configContent))

      const config = loadProjectConfig(testDir)
      expect(config.ignore).toEqual(['typescript'])
      expect(config.exclude).toEqual(['dist', 'node_modules'])
    })

    it('should prefer .inuprc over other config files', () => {
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ ignore: ['from-inuprc'] }))
      writeFileSync(join(testDir, '.inuprc.json'), JSON.stringify({ ignore: ['from-inuprc-json'] }))
      writeFileSync(
        join(testDir, 'inup.config.json'),
        JSON.stringify({ ignore: ['from-inup-config'] })
      )

      const config = loadProjectConfig(testDir)
      expect(config.ignore).toEqual(['from-inuprc'])
    })

    it('should search parent directories for config', () => {
      const subDir = join(testDir, 'packages', 'my-package')
      mkdirSync(subDir, { recursive: true })

      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ ignore: ['parent-config'] }))

      const config = loadProjectConfig(subDir)
      expect(config.ignore).toEqual(['parent-config'])
    })

    it('should handle invalid JSON gracefully', () => {
      writeFileSync(join(testDir, '.inuprc'), 'not valid json {')

      const config = loadProjectConfig(testDir)
      expect(config).toEqual({})
    })

    it('should filter out non-string values in ignore array', () => {
      const configContent = {
        ignore: ['valid', 123, 'also-valid', null, 'still-valid'],
      }
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify(configContent))

      const config = loadProjectConfig(testDir)
      expect(config.ignore).toEqual(['valid', 'also-valid', 'still-valid'])
    })

    it('should load showPeerDependencyVulnerabilities when set to a boolean', () => {
      writeFileSync(
        join(testDir, '.inuprc'),
        JSON.stringify({ showPeerDependencyVulnerabilities: true })
      )

      const config = loadProjectConfig(testDir)
      expect(config.showPeerDependencyVulnerabilities).toBe(true)
    })

    it('should load showOptionalDependencyVulnerabilities when set to a boolean', () => {
      writeFileSync(
        join(testDir, '.inuprc'),
        JSON.stringify({ showOptionalDependencyVulnerabilities: true })
      )

      const config = loadProjectConfig(testDir)
      expect(config.showOptionalDependencyVulnerabilities).toBe(true)
    })
  })

  describe('concurrency field', () => {
    it('accepts an integer concurrency within the pool range', () => {
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ concurrency: 8 }))
      expect(loadProjectConfig(testDir).concurrency).toBe(8)
    })

    it.each([
      ['"8"', '"8"'],
      ['zero', '0'],
      ['negative', '-3'],
      ['above pool', '99'],
      ['fractional', '7.5'],
    ])('drops an invalid concurrency value (%s) and says so', (_label, raw) => {
      // Silent dropping would invert the user's intent: they pinned a low limit
      // to protect a slow/metered link, and the run would adapt up to 24.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      writeFileSync(join(testDir, '.inuprc'), `{"concurrency": ${raw}}`)
      expect(loadProjectConfig(testDir).concurrency).toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('concurrency'))
      warn.mockRestore()
    })

    it('does not warn when concurrency is valid or absent', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ concurrency: 8 }))
      loadProjectConfig(testDir)
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ ignore: [] }))
      loadProjectConfig(testDir)
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  describe('isPackageIgnored()', () => {
    it('should match exact package names', () => {
      expect(isPackageIgnored('lodash', ['lodash'])).toBe(true)
      expect(isPackageIgnored('lodash', ['moment'])).toBe(false)
    })

    it('should match wildcard patterns with *', () => {
      expect(isPackageIgnored('@babel/core', ['@babel/*'])).toBe(true)
      expect(isPackageIgnored('@babel/preset-env', ['@babel/*'])).toBe(true)
      expect(isPackageIgnored('@types/node', ['@babel/*'])).toBe(false)
    })

    it('should match prefix patterns', () => {
      expect(isPackageIgnored('eslint-plugin-react', ['eslint-*'])).toBe(true)
      expect(isPackageIgnored('eslint-config-prettier', ['eslint-*'])).toBe(true)
      expect(isPackageIgnored('prettier', ['eslint-*'])).toBe(false)
    })

    it('should match suffix patterns', () => {
      expect(isPackageIgnored('react-dom', ['*-dom'])).toBe(true)
      expect(isPackageIgnored('preact-dom', ['*-dom'])).toBe(true)
      expect(isPackageIgnored('react', ['*-dom'])).toBe(false)
    })

    it('should match single character wildcard with ?', () => {
      expect(isPackageIgnored('lodash', ['lodas?'])).toBe(true)
      expect(isPackageIgnored('lodash', ['lod???'])).toBe(true)
      expect(isPackageIgnored('lodash', ['lod??'])).toBe(false)
    })

    it('should match multiple patterns', () => {
      const patterns = ['lodash', '@babel/*', 'eslint-*']
      expect(isPackageIgnored('lodash', patterns)).toBe(true)
      expect(isPackageIgnored('@babel/core', patterns)).toBe(true)
      expect(isPackageIgnored('eslint-plugin-react', patterns)).toBe(true)
      expect(isPackageIgnored('react', patterns)).toBe(false)
    })

    it('should return false for empty patterns array', () => {
      expect(isPackageIgnored('lodash', [])).toBe(false)
    })

    it('should handle scoped packages correctly', () => {
      expect(isPackageIgnored('@types/node', ['@types/*'])).toBe(true)
      expect(isPackageIgnored('@types/react', ['@types/react'])).toBe(true)
      expect(isPackageIgnored('@types/react-dom', ['@types/react'])).toBe(false)
      expect(isPackageIgnored('@types/react-dom', ['@types/react*'])).toBe(true)
    })

    it('should escape special regex characters in patterns', () => {
      // The dot in package names should be treated literally
      expect(isPackageIgnored('socket.io', ['socket.io'])).toBe(true)
      expect(isPackageIgnored('socketXio', ['socket.io'])).toBe(false)
    })
  })
})

describe('config normalization of list fields', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `inup-test-normalize-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('keeps only string entries in exclude and scanDirs', () => {
    writeFileSync(
      join(testDir, '.inuprc'),
      JSON.stringify({
        exclude: ['dist', 42, null, 'coverage'],
        scanDirs: ['packages', false, 'apps'],
      })
    )

    const config = loadProjectConfig(testDir)

    expect(config.exclude).toEqual(['dist', 'coverage'])
    expect(config.scanDirs).toEqual(['packages', 'apps'])
  })

  it('drops non-array exclude and scanDirs values', () => {
    writeFileSync(
      join(testDir, '.inuprc'),
      JSON.stringify({ exclude: 'dist', scanDirs: { nope: true } })
    )

    const config = loadProjectConfig(testDir)

    expect(config.exclude).toBeUndefined()
    expect(config.scanDirs).toBeUndefined()
  })
})
