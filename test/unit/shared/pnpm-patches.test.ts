import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findBlockingPatch, PnpmPatches } from '../../../src/shared/pnpm-patches'

// The two halves as callers combine them: read the pins, then test a target against them.
class Patches {
  private readonly patches = new PnpmPatches()
  findBlockingPatch(dir: string, name: string, version: string): string | null {
    return findBlockingPatch(name, this.patches.pinsFor(dir, name), version)
  }
}

describe('PnpmPatches', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'inup-patches-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const workspace = (yaml: string) => writeFileSync(join(root, 'pnpm-workspace.yaml'), yaml)
  const manifest = (json: unknown) =>
    writeFileSync(join(root, 'package.json'), JSON.stringify(json))

  it('blocks a bump that leaves the version a patch is pinned to', () => {
    workspace('patchedDependencies:\n  next@16.3.5: patches/next@16.3.5.patch\n')
    const patches = new Patches()
    expect(patches.findBlockingPatch(root, 'next', '16.4.0')).toBe('next@16.3.5')
    expect(patches.findBlockingPatch(root, 'next', '16.3.5')).toBeNull()
    expect(patches.findBlockingPatch(root, 'react', '19.0.0')).toBeNull()
  })

  it('reads the pnpm field of package.json, and scoped names', () => {
    manifest({ pnpm: { patchedDependencies: { '@scope/pkg@1.0.0': 'patches/a.patch' } } })
    const patches = new Patches()
    expect(patches.findBlockingPatch(root, '@scope/pkg', '1.0.1')).toBe('@scope/pkg@1.0.0')
  })

  it('finds the workspace root from a member directory', () => {
    workspace('patchedDependencies:\n  next@16.3.5: patches/next.patch\n')
    const member = join(root, 'apps', 'web')
    mkdirSync(member, { recursive: true })
    expect(new Patches().findBlockingPatch(member, 'next', '16.4.0')).toBe('next@16.3.5')
  })

  it('lets a bump through when a range patch still covers the target', () => {
    workspace(
      'patchedDependencies:\n  foo@^2.0.0: patches/foo-2.patch\n  foo@1.0.0: patches/foo-1.patch\n'
    )
    const patches = new Patches()
    expect(patches.findBlockingPatch(root, 'foo', '2.4.0')).toBeNull()
    expect(patches.findBlockingPatch(root, 'foo', '3.0.0')).toBe('foo@^2.0.0')
  })

  it('never blocks on name-only patches or selectors that are not a range', () => {
    workspace(
      'patchedDependencies:\n  bar: patches/bar.patch\n  "@scope/baz": patches/baz.patch\n  qux@not a range: patches/qux.patch\n'
    )
    const patches = new Patches()
    expect(patches.findBlockingPatch(root, 'bar', '9.0.0')).toBeNull()
    expect(patches.findBlockingPatch(root, '@scope/baz', '9.0.0')).toBeNull()
    expect(patches.findBlockingPatch(root, 'qux', '9.0.0')).toBeNull()
  })

  it('treats missing, malformed or patch-free config as no patches', () => {
    const patches = new Patches()
    expect(patches.findBlockingPatch(root, 'next', '16.4.0')).toBeNull()

    workspace('patchedDependencies: [oops\n')
    manifest({ pnpm: { patchedDependencies: ['next@16.3.5'] } })
    expect(new Patches().findBlockingPatch(root, 'next', '16.4.0')).toBeNull()

    workspace('packages:\n  - apps/*\n')
    writeFileSync(join(root, 'package.json'), '{ not json')
    expect(new Patches().findBlockingPatch(root, 'next', '16.4.0')).toBeNull()
  })

  it('reads each directory once', () => {
    workspace('patchedDependencies:\n  next@16.3.5: patches/next.patch\n')
    const patches = new Patches()
    expect(patches.findBlockingPatch(root, 'next', '16.4.0')).toBe('next@16.3.5')
    rmSync(join(root, 'pnpm-workspace.yaml'))
    expect(patches.findBlockingPatch(root, 'next', '16.4.0')).toBe('next@16.3.5')
  })
})
