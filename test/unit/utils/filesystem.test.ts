import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  findPackageJson,
  readPackageJson,
  readPackageJsonAsync,
  collectAllDependencies,
  collectAllDependenciesAsync,
  findAllPackageJsonFiles,
  findWorkspaceRoot,
} from '../../../src/utils/filesystem'

describe('filesystem utils', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'inup-fs-test-'))
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('findPackageJson()', () => {
    it('should find package.json in current directory', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'test' }))

      const result = findPackageJson(testDir)
      expect(result).toBe(join(testDir, 'package.json'))
    })

    it('should return null when package.json does not exist', () => {
      const result = findPackageJson(testDir)
      expect(result).toBeNull()
    })
  })

  describe('readPackageJson()', () => {
    it('should read and parse valid package.json', () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        dependencies: {
          chalk: '^5.0.0',
        },
      }
      const path = join(testDir, 'package.json')
      writeFileSync(path, JSON.stringify(packageJson))

      const result = readPackageJson(path)
      expect(result).toEqual(packageJson)
    })

    it('should throw error for invalid JSON', () => {
      const path = join(testDir, 'package.json')
      writeFileSync(path, 'invalid json{')

      expect(() => readPackageJson(path)).toThrow('Failed to read package.json')
    })

    it('should throw error for non-existent file', () => {
      const path = join(testDir, 'non-existent.json')

      expect(() => readPackageJson(path)).toThrow('Failed to read package.json')
    })
  })

  describe('readPackageJsonAsync()', () => {
    it('should read and parse valid package.json asynchronously', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
      }
      const path = join(testDir, 'package.json')
      writeFileSync(path, JSON.stringify(packageJson))

      const result = await readPackageJsonAsync(path)
      expect(result).toEqual(packageJson)
    })

    it('should reject for invalid JSON', async () => {
      const path = join(testDir, 'package.json')
      writeFileSync(path, 'invalid json{')

      await expect(readPackageJsonAsync(path)).rejects.toThrow('Failed to read package.json')
    })
  })

  describe('collectAllDependencies()', () => {
    it('should collect dependencies and devDependencies by default', () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          chalk: '^5.0.0',
          commander: '^12.0.0',
        },
        devDependencies: {
          typescript: '^5.0.0',
        },
      }
      const path = join(testDir, 'package.json')
      writeFileSync(path, JSON.stringify(packageJson))

      const result = collectAllDependencies([path])

      expect(result).toHaveLength(3)
      expect(result).toContainEqual({
        name: 'chalk',
        version: '^5.0.0',
        type: 'dependencies',
        packageJsonPath: path,
      })
      expect(result).toContainEqual({
        name: 'typescript',
        version: '^5.0.0',
        type: 'devDependencies',
        packageJsonPath: path,
      })
    })

    it('should include peerDependencies when option is enabled', () => {
      const packageJson = {
        name: 'test',
        peerDependencies: {
          react: '^18.0.0',
        },
      }
      const path = join(testDir, 'package.json')
      writeFileSync(path, JSON.stringify(packageJson))

      const result = collectAllDependencies([path], { includePeerDeps: true })

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: 'react',
        type: 'peerDependencies',
      })
    })

    it('should include optionalDependencies when option is enabled', () => {
      const packageJson = {
        name: 'test',
        optionalDependencies: {
          fsevents: '^2.0.0',
        },
      }
      const path = join(testDir, 'package.json')
      writeFileSync(path, JSON.stringify(packageJson))

      const result = collectAllDependencies([path], { includeOptionalDeps: true })

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: 'fsevents',
        type: 'optionalDependencies',
      })
    })

    it('should skip malformed package.json files', () => {
      const validPath = join(testDir, 'valid', 'package.json')
      const invalidPath = join(testDir, 'invalid', 'package.json')

      mkdirSync(join(testDir, 'valid'), { recursive: true })
      mkdirSync(join(testDir, 'invalid'), { recursive: true })

      writeFileSync(validPath, JSON.stringify({ name: 'valid', dependencies: { chalk: '5.0.0' } }))
      writeFileSync(invalidPath, 'invalid json{')

      const result = collectAllDependencies([validPath, invalidPath])

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('chalk')
    })

    it('should handle multiple package.json files', () => {
      const pkg1Path = join(testDir, 'pkg1', 'package.json')
      const pkg2Path = join(testDir, 'pkg2', 'package.json')

      mkdirSync(join(testDir, 'pkg1'), { recursive: true })
      mkdirSync(join(testDir, 'pkg2'), { recursive: true })

      writeFileSync(pkg1Path, JSON.stringify({ name: 'pkg1', dependencies: { chalk: '5.0.0' } }))
      writeFileSync(pkg2Path, JSON.stringify({ name: 'pkg2', dependencies: { commander: '12.0.0' } }))

      const result = collectAllDependencies([pkg1Path, pkg2Path])

      expect(result).toHaveLength(2)
      expect(result.find(d => d.name === 'chalk')).toBeDefined()
      expect(result.find(d => d.name === 'commander')).toBeDefined()
    })
  })

  describe('collectAllDependenciesAsync()', () => {
    it('should collect dependencies asynchronously', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          chalk: '^5.0.0',
        },
      }
      const path = join(testDir, 'package.json')
      writeFileSync(path, JSON.stringify(packageJson))

      const result = await collectAllDependenciesAsync([path])

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('chalk')
    })

    it('should handle multiple files in parallel', async () => {
      const pkg1Path = join(testDir, 'pkg1', 'package.json')
      const pkg2Path = join(testDir, 'pkg2', 'package.json')

      mkdirSync(join(testDir, 'pkg1'), { recursive: true })
      mkdirSync(join(testDir, 'pkg2'), { recursive: true })

      writeFileSync(pkg1Path, JSON.stringify({ name: 'pkg1', dependencies: { chalk: '5.0.0' } }))
      writeFileSync(pkg2Path, JSON.stringify({ name: 'pkg2', dependencies: { commander: '12.0.0' } }))

      const result = await collectAllDependenciesAsync([pkg1Path, pkg2Path])

      expect(result).toHaveLength(2)
    })
  })

  describe('findAllPackageJsonFiles()', () => {
    it('should find package.json in root directory', () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const result = findAllPackageJsonFiles(testDir)

      expect(result).toHaveLength(1)
      expect(result[0]).toBe(join(testDir, 'package.json'))
    })

    it('should find package.json files recursively', () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const packagesDir = join(testDir, 'packages')
      mkdirSync(join(packagesDir, 'pkg-a'), { recursive: true })
      mkdirSync(join(packagesDir, 'pkg-b'), { recursive: true })

      writeFileSync(join(packagesDir, 'pkg-a', 'package.json'), '{}')
      writeFileSync(join(packagesDir, 'pkg-b', 'package.json'), '{}')

      const result = findAllPackageJsonFiles(testDir)

      expect(result).toHaveLength(3)
    })

    it('should skip node_modules directories', () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const nodeModulesDir = join(testDir, 'node_modules', 'some-package')
      mkdirSync(nodeModulesDir, { recursive: true })
      writeFileSync(join(nodeModulesDir, 'package.json'), '{}')

      const result = findAllPackageJsonFiles(testDir)

      expect(result).toHaveLength(1)
      expect(result[0]).toBe(join(testDir, 'package.json'))
    })

    it('should skip directories matching exclude patterns', () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const testPkgDir = join(testDir, 'test-package')
      mkdirSync(testPkgDir, { recursive: true })
      writeFileSync(join(testPkgDir, 'package.json'), '{}')

      const result = findAllPackageJsonFiles(testDir, ['^test-'])

      expect(result).toHaveLength(1)
      expect(result[0]).toBe(join(testDir, 'package.json'))
    })

    it('should handle empty directories', () => {
      const result = findAllPackageJsonFiles(testDir)
      expect(result).toHaveLength(0)
    })

    it('should call progress callback', () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const progressCalls: Array<{ current: string; found: number }> = []

      findAllPackageJsonFiles(testDir, [], 10, (current, found) => {
        progressCalls.push({ current, found })
      })

      expect(progressCalls.length).toBeGreaterThan(0)
    })

    it('should respect max depth limit', () => {
      // Create deeply nested structure
      let currentDir = testDir
      for (let i = 0; i < 15; i++) {
        currentDir = join(currentDir, `level-${i}`)
        mkdirSync(currentDir, { recursive: true })
        writeFileSync(join(currentDir, 'package.json'), '{}')
      }

      const result = findAllPackageJsonFiles(testDir, [], 5)

      // Should find less than 15 due to depth limit
      expect(result.length).toBeLessThan(15)
    })
  })

  describe('findWorkspaceRoot()', () => {
    it('should find workspace root with pnpm', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ name: 'root' })
      )
      writeFileSync(join(testDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*')
      writeFileSync(join(testDir, 'pnpm-lock.yaml'), '')

      const pkgDir = join(testDir, 'packages', 'pkg-a')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'pkg-a' }))

      const result = findWorkspaceRoot(pkgDir, 'pnpm')
      expect(result).toBe(testDir)
    })

    it('should return null when not in workspace', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'test' }))

      const result = findWorkspaceRoot(testDir, 'npm')
      expect(result).toBeNull()
    })
  })
})
