import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { PackageManagerDetector } from '../../src/services/package-manager-detector'

/**
 * Integration tests for package manager detection and compatibility
 * These tests verify that inup can work with all supported package managers
 */
describe('Package Manager Integration Tests', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'inup-integration-'))
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  const createTestPackage = (dir: string) => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'test-package',
        version: '1.0.0',
        dependencies: {
          chalk: '4.0.0',
        },
      })
    )
  }

  describe('npm', () => {
    it('should detect npm from package-lock.json', () => {
      createTestPackage(testDir)

      // Create npm lock file
      execSync('npm install --package-lock-only --silent', {
        cwd: testDir,
        stdio: 'ignore',
      })

      expect(existsSync(join(testDir, 'package-lock.json'))).toBe(true)

      // Test that package manager detector can find it
      const pm = PackageManagerDetector.detect(testDir)
      expect(pm.name).toBe('npm')
    }, 30000)

    it('should detect npm from packageManager field', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          name: 'test-package',
          version: '1.0.0',
          packageManager: 'npm@10.0.0',
        })
      )

      const pm = PackageManagerDetector.detect(testDir)
      expect(pm.name).toBe('npm')
      expect(pm.installCommand).toBe('npm install')
    })
  })

  describe('yarn', () => {
    it('should detect yarn from yarn.lock', () => {
      createTestPackage(testDir)
      writeFileSync(join(testDir, 'yarn.lock'), '')

      const pm = PackageManagerDetector.detect(testDir)
      expect(pm.name).toBe('yarn')
      expect(pm.lockFile).toBe('yarn.lock')
    })

    it('should detect yarn from packageManager field', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          name: 'test-package',
          version: '1.0.0',
          packageManager: 'yarn@4.0.0',
        })
      )

      const pm = PackageManagerDetector.detect(testDir)
      expect(pm.name).toBe('yarn')
      expect(pm.installCommand).toBe('yarn install')
    })
  })

  describe('pnpm', () => {
    it('should detect pnpm from pnpm-lock.yaml', () => {
      createTestPackage(testDir)
      writeFileSync(join(testDir, 'pnpm-lock.yaml'), '')

      const pm = PackageManagerDetector.detect(testDir)
      expect(pm.name).toBe('pnpm')
      expect(pm.lockFile).toBe('pnpm-lock.yaml')
    })

    it('should detect pnpm from packageManager field', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          name: 'test-package',
          version: '1.0.0',
          packageManager: 'pnpm@10.0.0',
        })
      )

      const pm = PackageManagerDetector.detect(testDir)
      expect(pm.name).toBe('pnpm')
      expect(pm.installCommand).toBe('pnpm install')
      expect(pm.workspaceFile).toBe('pnpm-workspace.yaml')
    })

    it('should detect pnpm workspace configuration', () => {
      createTestPackage(testDir)
      writeFileSync(
        join(testDir, 'pnpm-workspace.yaml'),
        'packages:\n  - packages/*'
      )

      const root = PackageManagerDetector.findWorkspaceRoot(testDir, 'pnpm')
      expect(root).toBe(testDir)
    })
  })

  describe('bun', () => {
    it('should detect bun from bun.lockb', () => {
      createTestPackage(testDir)
      writeFileSync(join(testDir, 'bun.lockb'), '')

      const pm = PackageManagerDetector.detect(testDir)
      expect(pm.name).toBe('bun')
      expect(pm.lockFile).toBe('bun.lockb')
    })

    it('should detect bun from packageManager field', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          name: 'test-package',
          version: '1.0.0',
          packageManager: 'bun@1.0.0',
        })
      )

      const pm = PackageManagerDetector.detect(testDir)
      expect(pm.name).toBe('bun')
      expect(pm.installCommand).toBe('bun install')
    })
  })

  describe('workspace detection', () => {
    it('should detect npm/yarn workspaces from package.json', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          name: 'monorepo',
          version: '1.0.0',
          workspaces: ['packages/*'],
        })
      )

      const pkgDir = join(testDir, 'packages', 'pkg-a')
      mkdirSync(pkgDir, { recursive: true })
      createTestPackage(pkgDir)

      const root = PackageManagerDetector.findWorkspaceRoot(pkgDir, 'npm')
      expect(root).toBe(testDir)

      const isInWorkspace = PackageManagerDetector.isInWorkspace(pkgDir, 'npm')
      expect(isInWorkspace).toBe(true)
    })

    it('should detect yarn berry workspace format', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          name: 'monorepo',
          version: '1.0.0',
          workspaces: {
            packages: ['packages/*'],
          },
        })
      )

      const pkgDir = join(testDir, 'packages', 'pkg-a')
      mkdirSync(pkgDir, { recursive: true })
      createTestPackage(pkgDir)

      const root = PackageManagerDetector.findWorkspaceRoot(pkgDir, 'yarn')
      expect(root).toBe(testDir)
    })
  })
})
