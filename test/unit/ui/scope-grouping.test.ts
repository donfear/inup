import { describe, expect, it } from 'vitest'
import { buildScopeGroupedItems } from '../../../src/ui/state/scope-grouping'
import { PackageSelectionState, RenderableItem } from '../../../src/types'

const make = (overrides: Partial<PackageSelectionState>): PackageSelectionState => ({
  name: 'pkg',
  packageJsonPath: '/repo/package.json',
  packageJsonPaths: ['/repo/package.json'],
  currentVersionSpecifier: '^1.0.0',
  currentVersion: '1.0.0',
  rangeVersion: '1.0.0',
  latestVersion: '1.0.0',
  selectedOption: 'none',
  loadState: 'ready',
  hasRangeUpdate: false,
  hasMajorUpdate: false,
  type: 'dependencies',
  ...overrides,
})

describe('buildScopeGroupedItems', () => {
  it('returns empty array for empty input', () => {
    expect(buildScopeGroupedItems([])).toEqual([])
  })

  it('does not group standalone (non-scoped) packages', () => {
    const items = buildScopeGroupedItems([make({ name: 'react' }), make({ name: 'vue' })])
    expect(items.every((i) => i.type === 'package')).toBe(true)
    expect(items).toHaveLength(2)
  })

  it('does not group a scope with only one member', () => {
    const items = buildScopeGroupedItems([make({ name: '@apollo/client' })])
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe('package')
  })

  it('groups two packages sharing the same scope regardless of version', () => {
    const items = buildScopeGroupedItems([
      make({ name: '@tiptap/react', currentVersionSpecifier: '^3.0.0' }),
      make({ name: '@tiptap/pm', currentVersionSpecifier: '^3.1.0' }),
    ])
    expect(items[0].type).toBe('group-header')
    if (items[0].type === 'group-header') {
      expect(items[0].scope).toBe('@tiptap')
      expect(items[0].memberIndices).toEqual([0, 1])
      expect(items[0].collapsed).toBe(false)
    }
    // 1 header + 2 members
    expect(items).toHaveLength(3)
    expect(items[1].type).toBe('package')
    expect(items[2].type).toBe('package')
    if (items[1].type === 'package') expect(items[1].groupPosition).toBe('middle')
    if (items[2].type === 'package') expect(items[2].groupPosition).toBe('last')
  })

  it('groups packages with mixed versions (no majority-version requirement)', () => {
    // The 4 @graphql-codegen packages in the screenshot — all different versions.
    const items = buildScopeGroupedItems([
      make({ name: '@graphql-codegen/cli', currentVersionSpecifier: '^6.3.1' }),
      make({ name: '@graphql-codegen/schema-ast', currentVersionSpecifier: '^5.0.2' }),
      make({ name: '@graphql-codegen/typescript', currentVersionSpecifier: '^5.0.10' }),
      make({ name: '@graphql-codegen/typescript-operations', currentVersionSpecifier: '^5.1.0' }),
    ])
    const header = items[0]
    expect(header.type).toBe('group-header')
    if (header.type === 'group-header') {
      expect(header.memberIndices).toHaveLength(4)
    }
    expect(items.filter((i) => i.type === 'package')).toHaveLength(4)
  })

  it('hides member rows when a scope is in collapsedScopes', () => {
    const items = buildScopeGroupedItems(
      [make({ name: '@tiptap/react' }), make({ name: '@tiptap/pm' })],
      { collapsedScopes: new Set(['@tiptap']) }
    )
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe('group-header')
    if (items[0].type === 'group-header') {
      expect(items[0].collapsed).toBe(true)
      // Even when collapsed, header retains member indices so cycling still works.
      expect(items[0].memberIndices).toEqual([0, 1])
    }
  })

  it('interleaves standalone packages with scope groups, preserving input order', () => {
    const items = buildScopeGroupedItems([
      make({ name: 'react' }),
      make({ name: '@tiptap/react' }),
      make({ name: '@tiptap/pm' }),
      make({ name: 'vue' }),
    ])
    // Expected: react (package), @tiptap header, 2 members, vue (package)
    expect(items.map((i) => i.type)).toEqual([
      'package',
      'group-header',
      'package',
      'package',
      'package',
    ])
  })

  it('handles two packages with the same name (e.g. dep + peerDep) as a 2-member group', () => {
    // Mirrors the @apollo/client duplicate in the user's screenshot.
    const items = buildScopeGroupedItems([
      make({ name: '@apollo/client', type: 'dependencies' }),
      make({ name: '@apollo/client', type: 'peerDependencies' }),
    ])
    expect(items[0].type).toBe('group-header')
    if (items[0].type === 'group-header') {
      expect(items[0].scope).toBe('@apollo')
      expect(items[0].memberIndices).toEqual([0, 1])
    }
    expect(items).toHaveLength(3)
  })

  it('preserves originalIndex on grouped package rows so they map back to filteredStates', () => {
    const items = buildScopeGroupedItems([
      make({ name: 'standalone-a' }),
      make({ name: '@tiptap/react' }),
      make({ name: '@tiptap/pm' }),
    ])
    const pkgItems = items.filter((i): i is Extract<RenderableItem, { type: 'package' }> =>
      i.type === 'package'
    )
    expect(pkgItems.map((p) => p.originalIndex)).toEqual([0, 1, 2])
  })
})
