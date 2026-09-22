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
  collectAllDependenciesAsync,
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

  describe('collectAllDependenciesAsync()', () => {
    it('should collect dependencies and devDependencies by default', async () => {
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

      const result = await collectAllDependenciesAsync([path])

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

    it('should include peerDependencies', async () => {
      const packageJson = {
        name: 'test',
        peerDependencies: {
          react: '^18.0.0',
        },
      }
      const path = join(testDir, 'package.json')
      writeFileSync(path, JSON.stringify(packageJson))

      const result = await collectAllDependenciesAsync([path])

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: 'react',
        type: 'peerDependencies',
      })
    })

    it('should include optionalDependencies', async () => {
      const packageJson = {
        name: 'test',
        optionalDependencies: {
          fsevents: '^2.0.0',
        },
      }
      const path = join(testDir, 'package.json')
      writeFileSync(path, JSON.stringify(packageJson))

      const result = await collectAllDependenciesAsync([path])

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: 'fsevents',
        type: 'optionalDependencies',
      })
    })

    it('should skip malformed package.json files', async () => {
      const validPath = join(testDir, 'valid', 'package.json')
      const invalidPath = join(testDir, 'invalid', 'package.json')

      mkdirSync(join(testDir, 'valid'), { recursive: true })
      mkdirSync(join(testDir, 'invalid'), { recursive: true })

      writeFileSync(validPath, JSON.stringify({ name: 'valid', dependencies: { chalk: '5.0.0' } }))
      writeFileSync(invalidPath, 'invalid json{')

      const result = await collectAllDependenciesAsync([validPath, invalidPath])

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('chalk')
    })

    it('should handle multiple package.json files', async () => {
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
      expect(result.find((d) => d.name === 'chalk')).toBeDefined()
      expect(result.find((d) => d.name === 'commander')).toBeDefined()
    })
  })

  describe('findAllPackageJsonFilesAsync() basics', () => {
    it('should find package.json in root directory', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const result = await findAllPackageJsonFilesAsync(testDir)

      expect(result).toHaveLength(1)
      expect(result[0]).toBe(join(testDir, 'package.json'))
    })

    it('should skip directories matching exclude patterns', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const testPkgDir = join(testDir, 'test-package')
      mkdirSync(testPkgDir, { recursive: true })
      writeFileSync(join(testPkgDir, 'package.json'), '{}')

      const result = await findAllPackageJsonFilesAsync(testDir, ['^test-'])

      expect(result).toHaveLength(1)
      expect(result[0]).toBe(join(testDir, 'package.json'))
    })

    it('should handle empty directories', async () => {
      const result = await findAllPackageJsonFilesAsync(testDir)
      expect(result).toHaveLength(0)
    })

    it('should call progress callback', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}')

      const progressCalls: Array<{ current: string; found: number }> = []

      await findAllPackageJsonFilesAsync(testDir, [], 10, (current, found) => {
        progressCalls.push({ current, found })
      })

      expect(progressCalls.length).toBeGreaterThan(0)
    })

    it('ignores a directory literally named package.json', async () => {
      // A directory can legally be called package.json; collecting it would feed a
      // directory path into readFileSync later.
      mkdirSync(join(testDir, 'weird', 'package.json'), { recursive: true })
      writeFileSync(join(testDir, 'package.json'), '{}')

      const result = await findAllPackageJsonFilesAsync(testDir)

      expect(result).toEqual([join(testDir, 'package.json')])
    })

    it('finds packages inside non-ASCII directory names', async () => {
      const unicodeDir = join(testDir, 'pákkage-日本-🚀')
      mkdirSync(unicodeDir, { recursive: true })
      writeFileSync(join(unicodeDir, 'package.json'), '{}')

      expect(await findAllPackageJsonFilesAsync(testDir)).toEqual([
        join(unicodeDir, 'package.json'),
      ])
    })

    it('applies forward-slash exclude patterns to nested paths on every platform', async () => {
      // Users write excludes with `/` (e.g. ^packages/skipme); on Windows the relative
      // path is backslashed, so matching depends on the internal posix normalization.
      const keep = join(testDir, 'packages', 'keep')
      const skip = join(testDir, 'packages', 'skipme')
      mkdirSync(keep, { recursive: true })
      mkdirSync(skip, { recursive: true })
      writeFileSync(join(keep, 'package.json'), '{}')
      writeFileSync(join(skip, 'package.json'), '{}')

      const result = await findAllPackageJsonFilesAsync(testDir, ['^packages/skipme(?:/|$)'])

      expect(result).toEqual([join(keep, 'package.json')])
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

    it('skips a package under lib/ by default', async () => {
      seedLibPackage()
      const result = await findAllPackageJsonFilesAsync(testDir)
      expect(result).toEqual([join(testDir, 'package.json')])
    })

    it('finds a package under lib/ when scanDirs includes "lib"', async () => {
      const libPkg = seedLibPackage()
      const result = await findAllPackageJsonFilesAsync(testDir, [], 10, undefined, {
        scanDirs: ['lib'],
      })
      expect(result).toContain(libPkg)
    })

    it('fires onSkippedPackageDir for a pruned dir that holds a package.json', async () => {
      seedLibPackage()
      const skipped: string[] = []
      await findAllPackageJsonFilesAsync(testDir, [], 10, undefined, {
        onSkippedPackageDir: (dir) => skipped.push(dir),
      })
      expect(skipped).toContain('lib')
    })

    it('does not fire onSkippedPackageDir when the dir is re-included via scanDirs', async () => {
      seedLibPackage()
      const skipped: string[] = []
      await findAllPackageJsonFilesAsync(testDir, [], 10, undefined, {
        scanDirs: ['lib'],
        onSkippedPackageDir: (dir) => skipped.push(dir),
      })
      expect(skipped).toHaveLength(0)
    })

    it('skips dunder-prefixed tooling dirs, whose manifests are not real packages', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}')
      for (const dir of ['__fixtures__', '__mocks__', '__tests__', '__generated__']) {
        const pkg = join(testDir, 'src', dir, 'monorepo')
        mkdirSync(pkg, { recursive: true })
        writeFileSync(join(pkg, 'package.json'), '{}')
      }
      const skipped: string[] = []
      const result = await findAllPackageJsonFilesAsync(testDir, [], 10, undefined, {
        onSkippedPackageDir: (dir) => skipped.push(dir),
      })
      expect(result).toEqual([join(testDir, 'package.json')])
      expect(skipped).toHaveLength(0)
    })

    it('scans a dunder or hidden dir that scanDirs opts back in', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}')
      const generated = join(testDir, '__generated__', 'sdk')
      const hidden = join(testDir, '.tooling', 'plugin')
      for (const dir of [generated, hidden]) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'package.json'), '{}')
      }
      const options = { scanDirs: ['__generated__', '.tooling'] }
      const result = await findAllPackageJsonFilesAsync(testDir, [], 10, undefined, options)
      expect(result).toContain(join(generated, 'package.json'))
      expect(result).toContain(join(hidden, 'package.json'))
    })

    it('does not warn for node_modules or build-output dirs even when they hold a package.json', async () => {
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
      await findAllPackageJsonFilesAsync(testDir, [], 10, undefined, {
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
    it('warns when a pruned lib dir holds a package.json directly', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'root' }))
      mkdirSync(join(testDir, 'lib'))
      writeFileSync(join(testDir, 'lib', 'package.json'), JSON.stringify({ name: 'inner' }))
      const skipped: string[] = []

      const files = await findAllPackageJsonFilesAsync(testDir, [], 10, undefined, {
        onSkippedPackageDir: (dir) => skipped.push(dir),
      })

      expect(files).toEqual([join(testDir, 'package.json')])
      expect(skipped).toEqual(['lib'])
    })

    it('does not warn for a pruned lib dir whose children hold no packages', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'root' }))
      mkdirSync(join(testDir, 'lib'))
      mkdirSync(join(testDir, 'lib', '.hidden'))
      writeFileSync(join(testDir, 'lib', 'index.js'), '')
      mkdirSync(join(testDir, 'lib', 'nested'))
      writeFileSync(join(testDir, 'lib', 'nested', 'index.js'), '')
      const skipped: string[] = []

      await findAllPackageJsonFilesAsync(testDir, [], 10, undefined, {
        onSkippedPackageDir: (dir) => skipped.push(dir),
      })

      expect(skipped).toEqual([])
    })

    it('treats an unreadable pruned lib dir as packageless', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'root' }))
      mkdirSync(join(testDir, 'lib'))
      chmodSync(join(testDir, 'lib'), 0o000)
      const skipped: string[] = []

      try {
        await findAllPackageJsonFilesAsync(testDir, [], 10, undefined, {
          onSkippedPackageDir: (dir) => skipped.push(dir),
        })
        expect(skipped).toEqual([])
      } finally {
        chmodSync(join(testDir, 'lib'), 0o755)
      }
    })

    it('survives symlink cycles and broken symlinks', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'root' }))
      mkdirSync(join(testDir, 'a'))
      // Cycle: a/loop points back at the root that is already being scanned.
      symlinkSync(testDir, join(testDir, 'a', 'loop'), 'dir')
      // Broken symlink: stat fails, entry must be skipped.
      symlinkSync(join(testDir, 'gone'), join(testDir, 'broken'), 'file')

      const files = await findAllPackageJsonFilesAsync(testDir)

      expect(files).toEqual([join(testDir, 'package.json')])
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
