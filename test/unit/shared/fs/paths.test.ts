import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { findPackageJson, findWorkspaceRoot } from '../../../../src/shared/fs/paths'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'inup-paths-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('findPackageJson', () => {
  it('returns the package.json path when one exists', () => {
    writeFileSync(join(tempDir, 'package.json'), '{"name":"demo"}')

    expect(findPackageJson(tempDir)).toBe(join(tempDir, 'package.json'))
  })

  it('returns null when the directory has no package.json', () => {
    expect(findPackageJson(tempDir)).toBeNull()
  })
})

describe('findWorkspaceRoot', () => {
  it('finds the pnpm workspace root from a nested package', () => {
    writeFileSync(join(tempDir, 'package.json'), '{"name":"root"}')
    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
    const nested = join(tempDir, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'package.json'), '{"name":"app"}')

    expect(findWorkspaceRoot(nested, 'pnpm')).toBe(tempDir)
  })

  it('detects the package manager itself when none is given', () => {
    writeFileSync(join(tempDir, 'package.json'), '{"name":"root"}')
    writeFileSync(join(tempDir, 'pnpm-lock.yaml'), '')
    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")

    expect(findWorkspaceRoot(tempDir)).toBe(tempDir)
  })

  it('returns null when no workspace marker exists', () => {
    writeFileSync(join(tempDir, 'package.json'), '{"name":"standalone"}')

    expect(findWorkspaceRoot(tempDir, 'pnpm')).toBeNull()
  })
})
