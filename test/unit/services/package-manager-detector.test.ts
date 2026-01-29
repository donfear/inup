import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { PackageManagerDetector } from '../../../src/services/package-manager-detector'

describe('PackageManagerDetector', () => {
  let testDir: string

  beforeEach(() => {
    // Create a unique temporary directory for each test
    testDir = mkdtempSync(join(tmpdir(), 'inup-test-'))
  })

  afterEach(() => {
    // Clean up the test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('detect()', () => {
    it('should detect npm from packageManager field', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'npm@9.0.0' })
      )

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('npm')
    })

    it('should detect pnpm from packageManager field', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'pnpm@10.28.1' })
      )

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('pnpm')
    })

    it('should detect yarn from packageManager field', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'yarn@4.0.0' })
      )

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('yarn')
    })

    it('should detect bun from packageManager field', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'bun@1.0.0' })
      )

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('bun')
    })

    it('should detect npm from package-lock.json', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}))
      writeFileSync(join(testDir, 'package-lock.json'), '{}')

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('npm')
    })

    it('should detect pnpm from pnpm-lock.yaml', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}))
      writeFileSync(join(testDir, 'pnpm-lock.yaml'), '')

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('pnpm')
    })

    it('should detect yarn from yarn.lock', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}))
      writeFileSync(join(testDir, 'yarn.lock'), '')

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('yarn')
    })

    it('should detect bun from bun.lockb', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}))
      writeFileSync(join(testDir, 'bun.lockb'), '')

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('bun')
    })

    it('should prefer packageManager field over lock files', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'pnpm@10.0.0' })
      )
      writeFileSync(join(testDir, 'package-lock.json'), '{}')
      writeFileSync(join(testDir, 'yarn.lock'), '')

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('pnpm')
    })

    it('should use most recently modified lock file when multiple exist', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}))
      writeFileSync(join(testDir, 'package-lock.json'), '{}')

      // Wait a bit to ensure different mtime
      await new Promise(resolve => setTimeout(resolve, 100))

      // Create yarn.lock after npm lock to ensure it's newer
      writeFileSync(join(testDir, 'yarn.lock'), '')

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('yarn')
    })

    it('should fallback to npm when no package manager is detected', () => {
      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('npm')
    })

    it('should handle invalid package.json gracefully', () => {
      writeFileSync(join(testDir, 'package.json'), 'invalid json{')
      writeFileSync(join(testDir, 'yarn.lock'), '')

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('yarn')
    })
  })

  describe('getInfo()', () => {
    it('should return correct info for npm', () => {
      const info = PackageManagerDetector.getInfo('npm')
      expect(info.name).toBe('npm')
      expect(info.lockFile).toBe('package-lock.json')
      expect(info.installCommand).toBe('npm install')
    })

    it('should return correct info for pnpm', () => {
      const info = PackageManagerDetector.getInfo('pnpm')
      expect(info.name).toBe('pnpm')
      expect(info.lockFile).toBe('pnpm-lock.yaml')
      expect(info.workspaceFile).toBe('pnpm-workspace.yaml')
      expect(info.installCommand).toBe('pnpm install')
    })

    it('should return correct info for yarn', () => {
      const info = PackageManagerDetector.getInfo('yarn')
      expect(info.name).toBe('yarn')
      expect(info.lockFile).toBe('yarn.lock')
      expect(info.installCommand).toBe('yarn install')
    })

    it('should return correct info for bun', () => {
      const info = PackageManagerDetector.getInfo('bun')
      expect(info.name).toBe('bun')
      expect(info.lockFile).toBe('bun.lockb')
      expect(info.installCommand).toBe('bun install')
    })
  })

  describe('findWorkspaceRoot()', () => {
    it('should find workspace root with pnpm-workspace.yaml', () => {
      writeFileSync(join(testDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*')
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}))

      const packagesDir = join(testDir, 'packages', 'pkg1')
      mkdirSync(packagesDir, { recursive: true })
      writeFileSync(join(packagesDir, 'package.json'), JSON.stringify({}))

      const root = PackageManagerDetector.findWorkspaceRoot(packagesDir, 'pnpm')
      expect(root).toBe(testDir)
    })

    it('should find workspace root with package.json workspaces array', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*'] })
      )

      const packagesDir = join(testDir, 'packages', 'pkg1')
      mkdirSync(packagesDir, { recursive: true })
      writeFileSync(join(packagesDir, 'package.json'), JSON.stringify({}))

      const root = PackageManagerDetector.findWorkspaceRoot(packagesDir, 'npm')
      expect(root).toBe(testDir)
    })

    it('should find workspace root with package.json workspaces object (Yarn berry)', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ workspaces: { packages: ['packages/*'] } })
      )

      const packagesDir = join(testDir, 'packages', 'pkg1')
      mkdirSync(packagesDir, { recursive: true })
      writeFileSync(join(packagesDir, 'package.json'), JSON.stringify({}))

      const root = PackageManagerDetector.findWorkspaceRoot(packagesDir, 'yarn')
      expect(root).toBe(testDir)
    })

    it('should return null when not in a workspace', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}))

      const root = PackageManagerDetector.findWorkspaceRoot(testDir, 'npm')
      expect(root).toBeNull()
    })

    it('should handle empty workspaces array', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ workspaces: [] })
      )

      const root = PackageManagerDetector.findWorkspaceRoot(testDir, 'npm')
      expect(root).toBeNull()
    })
  })

  describe('isInWorkspace()', () => {
    it('should return true when in a workspace', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*'] })
      )

      const packagesDir = join(testDir, 'packages', 'pkg1')
      mkdirSync(packagesDir, { recursive: true })
      writeFileSync(join(packagesDir, 'package.json'), JSON.stringify({}))

      const result = PackageManagerDetector.isInWorkspace(packagesDir, 'npm')
      expect(result).toBe(true)
    })

    it('should return false when not in a workspace', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}))

      const result = PackageManagerDetector.isInWorkspace(testDir, 'npm')
      expect(result).toBe(false)
    })
  })
})
