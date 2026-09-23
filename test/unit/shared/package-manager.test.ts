import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PackageManagerDetector } from '../../../src/shared/package-manager'

// os.homedir() reads the real process env, which vi.stubEnv can't reach from a worker thread.
const home = vi.hoisted(() => ({ dir: undefined as string | undefined }))
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>()
  return { ...os, homedir: () => home.dir ?? os.homedir() }
})

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
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ packageManager: 'npm@9.0.0' }))

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('npm')
    })

    it('ignores an unrecognized packageManager field and falls back to the lockfile', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'weird@1.0.0' })
      )
      writeFileSync(join(testDir, 'yarn.lock'), '')

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('yarn')
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
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ packageManager: 'yarn@4.0.0' }))

      const result = PackageManagerDetector.detect(testDir)
      expect(result.name).toBe('yarn')
    })

    it('should detect bun from packageManager field', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ packageManager: 'bun@1.0.0' }))

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

    it('should detect bun from text bun.lock (Bun >= 1.2)', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}))
      writeFileSync(join(testDir, 'bun.lock'), '')

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
      await new Promise((resolve) => setTimeout(resolve, 100))

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

    it('accepts a packageManager field carrying a corepack integrity hash', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'pnpm@10.28.1+sha512.abc123def' })
      )

      expect(PackageManagerDetector.detect(testDir).name).toBe('pnpm')
    })

    it('survives a non-string packageManager field without crashing', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: { name: 'pnpm' } })
      )
      writeFileSync(join(testDir, 'pnpm-lock.yaml'), '')

      expect(PackageManagerDetector.detect(testDir).name).toBe('pnpm')
    })

    it('does not treat a bare name prefix like "pnpm-fork@1.0.0" as pnpm', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'pnpm-fork@1.0.0' })
      )
      writeFileSync(join(testDir, 'yarn.lock'), '')

      expect(PackageManagerDetector.detect(testDir).name).toBe('yarn')
    })

    it('reads the packageManager field when package.json starts with a UTF-8 BOM', () => {
      // Windows editors love BOMs; the mark is stripped before parsing, so the field
      // still wins over the lockfile exactly as it does for a BOM-less manifest.
      writeFileSync(
        join(testDir, 'package.json'),
        `\uFEFF${JSON.stringify({ packageManager: 'yarn@4.0.0' })}`
      )
      writeFileSync(join(testDir, 'pnpm-lock.yaml'), '')

      expect(PackageManagerDetector.detect(testDir).name).toBe('yarn')
    })

    describe('from a subdirectory', () => {
      /** A workspace member under `root` with its own package.json and no lockfile. */
      function makeMember(root: string): string {
        const member = join(root, 'packages', 'a')
        mkdirSync(member, { recursive: true })
        writeFileSync(join(member, 'package.json'), JSON.stringify({ name: 'a' }))
        return member
      }

      it('finds the lockfile at the workspace root', () => {
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({}))
        writeFileSync(join(testDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*')
        writeFileSync(join(testDir, 'pnpm-lock.yaml'), '')

        expect(PackageManagerDetector.detect(makeMember(testDir)).name).toBe('pnpm')
      })

      it('finds the packageManager field at the workspace root', () => {
        writeFileSync(
          join(testDir, 'package.json'),
          JSON.stringify({ packageManager: 'yarn@4.0.0', workspaces: ['packages/*'] })
        )

        expect(PackageManagerDetector.detect(makeMember(testDir)).name).toBe('yarn')
      })

      it('prefers the nearest directory that names a package manager', () => {
        writeFileSync(join(testDir, 'pnpm-lock.yaml'), '')
        const member = makeMember(testDir)
        writeFileSync(join(member, 'bun.lock'), '')

        expect(PackageManagerDetector.detect(member).name).toBe('bun')
      })

      it('reads the git root itself', () => {
        mkdirSync(join(testDir, '.git'))
        writeFileSync(join(testDir, 'pnpm-lock.yaml'), '')

        expect(PackageManagerDetector.detect(makeMember(testDir)).name).toBe('pnpm')
      })

      it('never looks above the git root', () => {
        writeFileSync(join(testDir, 'yarn.lock'), '')
        const repo = join(testDir, 'repo')
        mkdirSync(join(repo, '.git'), { recursive: true })

        expect(PackageManagerDetector.detect(makeMember(repo)).name).toBe('npm')
      })

      it('ignores a stray lockfile in the home directory', () => {
        home.dir = testDir
        try {
          writeFileSync(join(testDir, 'pnpm-lock.yaml'), '')
          const project = join(testDir, 'code', 'app')
          mkdirSync(project, { recursive: true })

          expect(PackageManagerDetector.detect(project).name).toBe('npm')
          // Run from the home directory itself, its lockfile still counts.
          expect(PackageManagerDetector.detect(testDir).name).toBe('pnpm')
        } finally {
          home.dir = undefined
        }
      })
    })
  })

  describe('getInfo()', () => {
    it('should return correct info for npm', () => {
      const info = PackageManagerDetector.getInfo('npm')
      expect(info.name).toBe('npm')
      expect(info.lockFile).toBe('package-lock.json')
      expect(info.installCommand).toBe('npm install')
      // npm has no CI frozen default, so it falls back to installCommand.
      expect(info.writeInstallCommand).toBeUndefined()
    })

    it('should return correct info for pnpm', () => {
      const info = PackageManagerDetector.getInfo('pnpm')
      expect(info.name).toBe('pnpm')
      expect(info.lockFile).toBe('pnpm-lock.yaml')
      expect(info.workspaceFile).toBe('pnpm-workspace.yaml')
      expect(info.installCommand).toBe('pnpm install')
      // After writing upgrades, the install must opt out of CI's frozen-lockfile default.
      expect(info.writeInstallCommand).toBe('pnpm install --no-frozen-lockfile')
    })

    it('should return correct info for yarn', () => {
      const info = PackageManagerDetector.getInfo('yarn')
      expect(info.name).toBe('yarn')
      expect(info.lockFile).toBe('yarn.lock')
      expect(info.installCommand).toBe('yarn install')
      // Yarn Berry is immutable in CI; the write-time install opts out.
      expect(info.writeInstallCommand).toBe('yarn install --no-immutable')
    })

    it('should return correct info for bun', () => {
      const info = PackageManagerDetector.getInfo('bun')
      expect(info.name).toBe('bun')
      // Bun >= 1.2's text lockfile; detection also still accepts the legacy bun.lockb.
      expect(info.lockFile).toBe('bun.lock')
      expect(info.installCommand).toBe('bun install')
    })
  })

  describe('resolve()', () => {
    it('uses the explicit override without detecting', () => {
      // No lockfile or packageManager field: detection would fall back to npm.
      expect(PackageManagerDetector.resolve({ cwd: testDir, packageManager: 'yarn' }).name).toBe(
        'yarn'
      )
    })

    it('detects from cwd when no override is given', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}))
      writeFileSync(join(testDir, 'pnpm-lock.yaml'), '')

      expect(PackageManagerDetector.resolve({ cwd: testDir }).name).toBe('pnpm')
    })

    it('detects from process.cwd() when given no options', () => {
      const cwd = vi.spyOn(process, 'cwd').mockReturnValue(testDir)
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        writeFileSync(join(testDir, 'bun.lock'), '')
        expect(PackageManagerDetector.resolve().name).toBe('bun')
      } finally {
        cwd.mockRestore()
        error.mockRestore()
      }
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
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }))

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
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ workspaces: [] }))

      const root = PackageManagerDetector.findWorkspaceRoot(testDir, 'npm')
      expect(root).toBeNull()
    })
  })
})
