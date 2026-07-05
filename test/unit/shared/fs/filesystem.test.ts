import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectAllDependencies,
  collectAllDependenciesAsync,
  findAllPackageJsonFiles,
  findAllPackageJsonFilesAsync,
  findPackageJson,
  findWorkspaceRoot,
  readPackageJson,
  readPackageJsonAsync,
} from '../../../../src/shared/fs'

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
      writeFileSync(
        pkg2Path,
        JSON.stringify({ name: 'pkg2', dependencies: { commander: '12.0.0' } })
      )

      const result = collectAllDependencies([pkg1Path, pkg2Path])

      expect(result).toHaveLength(2)
      expect(result.find((d) => d.name === 'chalk')).toBeDefined()
      expect(result.find((d) => d.name === 'commander')).toBeDefined()
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
      writeFileSync(
        pkg2Path,
        JSON.stringify({ name: 'pkg2', dependencies: { commander: '12.0.0' } })
      )

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

    it('should skip hidden directories', () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const hiddenDir = join(testDir, '.turbo', 'nested-package')
      mkdirSync(hiddenDir, { recursive: true })
      writeFileSync(join(hiddenDir, 'package.json'), '{}')

      const result = findAllPackageJsonFiles(testDir)

      expect(result).toEqual([join(testDir, 'package.json')])
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

    it('should keep reporting progress while scanning a large directory', () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const largeDir = join(testDir, 'large-dir')
      mkdirSync(largeDir, { recursive: true })
      for (let i = 0; i < 20; i++) {
        writeFileSync(join(largeDir, `file-${i}.txt`), 'content')
      }

      const progressCalls: Array<{ current: string; found: number }> = []
      let now = 0
      const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
        now += 100
        return now
      })

      try {
        findAllPackageJsonFiles(testDir, [], 10, (current, found) => {
          progressCalls.push({ current, found })
        })
      } finally {
        dateNowSpy.mockRestore()
      }

      expect(progressCalls.length).toBeGreaterThan(1)
      expect(progressCalls.some((call) => call.current === 'large-dir')).toBe(true)
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

  describe('scanDirs override and skip warnings', () => {
    function seedLibPackage(): string {
      writeFileSync(join(testDir, 'package.json'), '{}')
      const libPkgDir = join(testDir, 'lib', 'inner')
      mkdirSync(libPkgDir, { recursive: true })
      writeFileSync(join(libPkgDir, 'package.json'), '{}')
      return join(libPkgDir, 'package.json')
    }

    it('skips a package under lib/ by default', () => {
      seedLibPackage()
      const result = findAllPackageJsonFiles(testDir)
      expect(result).toEqual([join(testDir, 'package.json')])
    })

    it('finds a package under lib/ when scanDirs includes "lib" (sync)', () => {
      const libPkg = seedLibPackage()
      const result = findAllPackageJsonFiles(testDir, [], 10, undefined, { scanDirs: ['lib'] })
      expect(result).toContain(libPkg)
    })

    it('finds a package under lib/ when scanDirs includes "lib" (async)', async () => {
      const libPkg = seedLibPackage()
      const result = await findAllPackageJsonFilesAsync(testDir, [], 10, undefined, {
        scanDirs: ['lib'],
      })
      expect(result).toContain(libPkg)
    })

    it('fires onSkippedPackageDir for a pruned dir that holds a package.json', () => {
      seedLibPackage()
      const skipped: string[] = []
      findAllPackageJsonFiles(testDir, [], 10, undefined, {
        onSkippedPackageDir: (dir) => skipped.push(dir),
      })
      expect(skipped).toContain('lib')
    })

    it('does not fire onSkippedPackageDir when the dir is re-included via scanDirs', () => {
      seedLibPackage()
      const skipped: string[] = []
      findAllPackageJsonFiles(testDir, [], 10, undefined, {
        scanDirs: ['lib'],
        onSkippedPackageDir: (dir) => skipped.push(dir),
      })
      expect(skipped).toHaveLength(0)
    })

    it('does not warn for node_modules or build-output dirs even when they hold a package.json', () => {
      writeFileSync(join(testDir, 'package.json'), '{}')
      // node_modules always holds package.json files — warning here would be pure noise
      const nm = join(testDir, 'node_modules', 'pkg')
      mkdirSync(nm, { recursive: true })
      writeFileSync(join(nm, 'package.json'), '{}')
      // dist is build output — a package.json there is expected, not a "silently skipped package"
      const dist = join(testDir, 'dist')
      mkdirSync(dist, { recursive: true })
      writeFileSync(join(dist, 'package.json'), '{}')

      const skipped: string[] = []
      findAllPackageJsonFiles(testDir, [], 10, undefined, {
        onSkippedPackageDir: (dir) => skipped.push(dir),
      })
      expect(skipped).toHaveLength(0)
    })
  })

  describe('findAllPackageJsonFilesAsync()', () => {
    it('should find package.json files recursively', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const packagesDir = join(testDir, 'packages')
      mkdirSync(join(packagesDir, 'pkg-a'), { recursive: true })
      mkdirSync(join(packagesDir, 'pkg-b'), { recursive: true })

      writeFileSync(join(packagesDir, 'pkg-a', 'package.json'), '{}')
      writeFileSync(join(packagesDir, 'pkg-b', 'package.json'), '{}')

      const result = await findAllPackageJsonFilesAsync(testDir)

      expect(result).toHaveLength(3)
      expect(result).toContain(join(testDir, 'package.json'))
      expect(result).toContain(join(packagesDir, 'pkg-a', 'package.json'))
      expect(result).toContain(join(packagesDir, 'pkg-b', 'package.json'))
    })

    it('should skip node_modules directories and exclude patterns', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const nodeModulesDir = join(testDir, 'node_modules', 'some-package')
      const excludedDir = join(testDir, 'skip-me')
      mkdirSync(nodeModulesDir, { recursive: true })
      mkdirSync(excludedDir, { recursive: true })

      writeFileSync(join(nodeModulesDir, 'package.json'), '{}')
      writeFileSync(join(excludedDir, 'package.json'), '{}')

      const result = await findAllPackageJsonFilesAsync(testDir, ['^skip-me'])

      expect(result).toEqual([join(testDir, 'package.json')])
    })

    it('should skip hidden directories', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const hiddenDir = join(testDir, '.turbo', 'nested-package')
      mkdirSync(hiddenDir, { recursive: true })
      writeFileSync(join(hiddenDir, 'package.json'), '{}')

      const result = await findAllPackageJsonFilesAsync(testDir)

      expect(result).toEqual([join(testDir, 'package.json')])
    })

    it('should call progress callback while scanning large directories', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const largeDir = join(testDir, 'large-dir')
      mkdirSync(largeDir, { recursive: true })
      for (let i = 0; i < 20; i++) {
        writeFileSync(join(largeDir, `file-${i}.txt`), 'content')
      }

      const progressCalls: Array<{ current: string; found: number }> = []
      let now = 0
      const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
        now += 100
        return now
      })

      try {
        await findAllPackageJsonFilesAsync(testDir, [], 10, (current, found) => {
          progressCalls.push({ current, found })
        })
      } finally {
        dateNowSpy.mockRestore()
      }

      expect(progressCalls.length).toBeGreaterThan(1)
      expect(progressCalls.some((call) => call.current === 'large-dir')).toBe(true)
    })

    it('should respect max depth limit', async () => {
      let currentDir = testDir
      for (let i = 0; i < 15; i++) {
        currentDir = join(currentDir, `level-${i}`)
        mkdirSync(currentDir, { recursive: true })
        writeFileSync(join(currentDir, 'package.json'), '{}')
      }

      const result = await findAllPackageJsonFilesAsync(testDir, [], 5)

      expect(result.length).toBeLessThan(15)
    })
  })

  describe('findWorkspaceRoot()', () => {
    it('should find workspace root with pnpm', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'root' }))
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

  describe('scan edge paths', () => {
    it('warns when a pruned lib dir holds a package.json directly', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'root' }))
      mkdirSync(join(testDir, 'lib'))
      writeFileSync(join(testDir, 'lib', 'package.json'), JSON.stringify({ name: 'inner' }))
      const skipped: string[] = []

      const files = findAllPackageJsonFiles(testDir, [], 10, undefined, {
        onSkippedPackageDir: (dir) => skipped.push(dir),
      })

      expect(files).toEqual([join(testDir, 'package.json')])
      expect(skipped).toEqual(['lib'])
    })

    it('does not warn for a pruned lib dir whose children hold no packages', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'root' }))
      mkdirSync(join(testDir, 'lib'))
      mkdirSync(join(testDir, 'lib', '.hidden'))
      writeFileSync(join(testDir, 'lib', 'index.js'), '')
      mkdirSync(join(testDir, 'lib', 'nested'))
      writeFileSync(join(testDir, 'lib', 'nested', 'index.js'), '')
      const skipped: string[] = []

      findAllPackageJsonFiles(testDir, [], 10, undefined, {
        onSkippedPackageDir: (dir) => skipped.push(dir),
      })

      expect(skipped).toEqual([])
    })

    it('treats an unreadable pruned lib dir as packageless', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'root' }))
      mkdirSync(join(testDir, 'lib'))
      chmodSync(join(testDir, 'lib'), 0o000)
      const skipped: string[] = []

      try {
        findAllPackageJsonFiles(testDir, [], 10, undefined, {
          onSkippedPackageDir: (dir) => skipped.push(dir),
        })
        expect(skipped).toEqual([])
      } finally {
        chmodSync(join(testDir, 'lib'), 0o755)
      }
    })

    it('survives symlink cycles and broken symlinks in both scanners', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'root' }))
      mkdirSync(join(testDir, 'a'))
      // Cycle: a/loop points back at the root that is already being scanned.
      symlinkSync(testDir, join(testDir, 'a', 'loop'), 'dir')
      // Broken symlink: stat fails, entry must be skipped.
      symlinkSync(join(testDir, 'gone'), join(testDir, 'broken'), 'file')

      const syncFiles = findAllPackageJsonFiles(testDir)
      const asyncFiles = await findAllPackageJsonFilesAsync(testDir)

      expect(syncFiles).toEqual([join(testDir, 'package.json')])
      expect(asyncFiles).toEqual([join(testDir, 'package.json')])
    })

    it('resolves to an empty list for a vanished root (async)', async () => {
      await expect(findAllPackageJsonFilesAsync(join(testDir, 'no-such-dir'))).resolves.toEqual([])
    })

    it('skips an unreadable subdirectory (async)', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'root' }))
      mkdirSync(join(testDir, 'locked'))
      chmodSync(join(testDir, 'locked'), 0o000)

      try {
        await expect(findAllPackageJsonFilesAsync(testDir)).resolves.toEqual([
          join(testDir, 'package.json'),
        ])
      } finally {
        chmodSync(join(testDir, 'locked'), 0o755)
      }
    })

    it('rejects the scan when the progress callback throws mid-run', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'root' }))
      // Enough directories that BOTH the forced 10th and 20th progress reports
      // fire (outside the root '.' report). With every directory in flight at
      // once, both reports throw: the first rejection fails the scan, the
      // second exercises the already-failed path.
      for (let i = 0; i < 25; i++) {
        mkdirSync(join(testDir, `pkg-${i}`))
      }

      await expect(
        findAllPackageJsonFilesAsync(
          testDir,
          [],
          10,
          (dir) => {
            if (dir !== '.') {
              throw new Error('progress boom')
            }
          },
          { concurrency: 64 }
        )
      ).rejects.toThrow('progress boom')
    })
  })
})
