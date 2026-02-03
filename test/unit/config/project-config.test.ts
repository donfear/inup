import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadProjectConfig, isPackageIgnored } from '../../../src/config/project-config'

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
