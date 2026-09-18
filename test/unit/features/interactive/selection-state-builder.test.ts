import { describe, expect, it, vi } from 'vitest'
import {
  createPendingSelectionStates,
  createSelectionStates,
  createUpgradeChoices,
  deduplicatePackages,
  selectionKey,
} from '../../../../src/features/interactive/session/selection-state-builder'
import type { PackageSelectionState } from '../../../../src/shared/types'
import { makePackageInfo } from '../../../fixtures/package-info-factory'

const noSummary = () => undefined

function makeState(overrides: Partial<PackageSelectionState> = {}): PackageSelectionState {
  return {
    name: 'left-pad',
    packageJsonPath: '/repo/package.json',
    currentVersionSpecifier: '^1.2.3',
    currentVersion: '1.2.3',
    rangeVersion: '1.4.0',
    latestVersion: '2.0.0',
    selectedOption: 'latest',
    loadState: 'ready',
    hasRangeUpdate: true,
    hasMajorUpdate: true,
    type: 'dependencies',
    ...overrides,
  }
}

describe('selectionKey', () => {
  it('keeps the legacy format for regular deps and namespaces catalog entries', () => {
    // The non-catalog format must stay stable: previousSelections round-trips
    // through it between re-scans (see upgrade-runner).
    expect(selectionKey('react', '^18.0.0', 'dependencies')).toBe('react@^18.0.0@dependencies')
    expect(selectionKey('react', '^18.0.0', 'dependencies', 'default')).toBe(
      'react@^18.0.0@dependencies@catalog:default'
    )
  })

  it('separates identical entries from different catalogs', () => {
    const fromDefault = selectionKey('react', '^18.0.0', 'dependencies', 'default')
    const fromNamed = selectionKey('react', '^18.0.0', 'dependencies', 'react18')

    expect(fromDefault).not.toBe(fromNamed)
  })
})

describe('createUpgradeChoices', () => {
  it('preserves the range prefix by default', () => {
    const choices = createUpgradeChoices([
      makeState({ currentVersionSpecifier: '^1.2.3', selectedOption: 'latest' }),
      makeState({ currentVersionSpecifier: '~1.2.3', selectedOption: 'range' }),
    ])

    expect(choices[0].targetVersion).toBe('^2.0.0')
    expect(choices[1].targetVersion).toBe('~1.4.0')
  })

  it('writes bare versions when saveExact is true', () => {
    const choices = createUpgradeChoices(
      [
        makeState({ currentVersionSpecifier: '^1.2.3', selectedOption: 'latest' }),
        makeState({ currentVersionSpecifier: '~1.2.3', selectedOption: 'range' }),
      ],
      true
    )

    expect(choices[0].targetVersion).toBe('2.0.0')
    expect(choices[1].targetVersion).toBe('1.4.0')
  })

  it('skips states that are not ready or not selected', () => {
    const choices = createUpgradeChoices([
      makeState({ selectedOption: 'none' }),
      makeState({ loadState: 'pending' }),
    ])

    expect(choices).toHaveLength(0)
  })

  it('fans out one choice per package.json path', () => {
    const choices = createUpgradeChoices([
      makeState({ packageJsonPaths: ['/repo/a/package.json', '/repo/b/package.json'] }),
    ])

    expect(choices).toHaveLength(2)
    expect(choices.map((c) => c.packageJsonPath)).toEqual([
      '/repo/a/package.json',
      '/repo/b/package.json',
    ])
    expect(choices[0].name).toBe('left-pad')
    expect(choices[0].upgradeType).toBe('latest')
  })

  it('falls back to the single packageJsonPath when no path list exists', () => {
    const choices = createUpgradeChoices([makeState({ packageJsonPaths: undefined })])

    expect(choices).toHaveLength(1)
    expect(choices[0].packageJsonPath).toBe('/repo/package.json')
  })

  it('uses the range version for range selections', () => {
    const choices = createUpgradeChoices([makeState({ selectedOption: 'range' })])

    expect(choices[0].targetVersion).toBe('^1.4.0')
    expect(choices[0].upgradeType).toBe('range')
  })

  it('carries the pnpm catalog through to every choice', () => {
    const choices = createUpgradeChoices([
      makeState({
        packageJsonPath: '/repo/pnpm-workspace.yaml',
        packageJsonPaths: ['/repo/pnpm-workspace.yaml'],
        catalog: 'react19',
      }),
    ])

    expect(choices).toHaveLength(1)
    expect(choices[0].catalog).toBe('react19')
    expect(choices[0].packageJsonPath).toBe('/repo/pnpm-workspace.yaml')
  })
})

describe('deduplicatePackages', () => {
  it('merges duplicate name@version@type entries and collects their paths', () => {
    const result = deduplicatePackages([
      makePackageInfo({ packageJsonPath: '/repo/a/package.json' }),
      makePackageInfo({ packageJsonPath: '/repo/b/package.json' }),
    ])

    expect(result.size).toBe(1)
    const entry = result.values().next().value!
    expect(Array.from(entry.packageJsonPaths)).toEqual([
      '/repo/a/package.json',
      '/repo/b/package.json',
    ])
  })

  it('keeps entries with different versions or types separate', () => {
    const result = deduplicatePackages([
      makePackageInfo({ currentVersion: '^1.0.0' }),
      makePackageInfo({ currentVersion: '^2.0.0' }),
      makePackageInfo({ type: 'devDependencies' }),
    ])

    expect(result.size).toBe(3)
  })

  it('never merges a pnpm catalog entry with an identical direct dependency', () => {
    // Same name/range/type — but one is written to pnpm-workspace.yaml and the
    // other to a package.json, so they must stay separate rows.
    const result = deduplicatePackages([
      makePackageInfo({ packageJsonPath: '/repo/a/package.json' }),
      makePackageInfo({ packageJsonPath: '/repo/pnpm-workspace.yaml', catalog: 'default' }),
    ])

    expect(result.size).toBe(2)
    const catalogEntry = Array.from(result.values()).find(({ pkg }) => pkg.catalog)
    expect(Array.from(catalogEntry!.packageJsonPaths)).toEqual(['/repo/pnpm-workspace.yaml'])
  })

  it('sorts scoped packages first, then alphabetically', () => {
    const result = deduplicatePackages([
      makePackageInfo({ name: 'zeta' }),
      makePackageInfo({ name: 'alpha' }),
      makePackageInfo({ name: '@scope/pkg' }),
    ])

    expect(Array.from(result.values()).map(({ pkg }) => pkg.name)).toEqual([
      '@scope/pkg',
      'alpha',
      'zeta',
    ])
  })
})

describe('createSelectionStates', () => {
  it('coerces version specifiers to clean versions', () => {
    const [state] = createSelectionStates(
      [
        makePackageInfo({
          currentVersion: '^1.0.0',
          rangeVersion: '1.1.0',
          latestVersion: '2.0.0',
        }),
      ],
      noSummary
    )

    expect(state.currentVersion).toBe('1.0.0')
    expect(state.currentVersionSpecifier).toBe('^1.0.0')
    expect(state.rangeVersion).toBe('1.1.0')
    expect(state.latestVersion).toBe('2.0.0')
    expect(state.loadState).toBe('ready')
  })

  it('keeps non-coercible versions as-is', () => {
    const [state] = createSelectionStates(
      [
        makePackageInfo({
          currentVersion: 'workspace:*',
          rangeVersion: 'workspace:*',
          latestVersion: 'workspace:*',
        }),
      ],
      noSummary
    )

    expect(state.currentVersion).toBe('workspace:*')
    expect(state.rangeVersion).toBe('workspace:*')
  })

  it('restores previous selections by package key', () => {
    const previous = new Map<string, 'none' | 'range' | 'latest'>([
      ['test-pkg@^1.0.0@dependencies', 'latest'],
    ])

    const [state] = createSelectionStates([makePackageInfo()], noSummary, previous)

    expect(state.selectedOption).toBe('latest')
  })

  it('defaults to no selection without a previous entry', () => {
    const [state] = createSelectionStates([makePackageInfo()], noSummary, new Map())

    expect(state.selectedOption).toBe('none')
  })

  it('filters out up-to-date packages when includeUpToDate is false', () => {
    const states = createSelectionStates(
      [
        makePackageInfo({ isOutdated: false }),
        makePackageInfo({ name: 'stale', isOutdated: true }),
      ],
      noSummary,
      undefined,
      false
    )

    expect(states.map((s) => s.name)).toEqual(['stale'])
  })

  it('attaches cached vulnerability summaries', () => {
    const summary = { count: 1, highestSeverity: 'high' as const, detailsUrl: 'x', advisories: [] }
    const getCachedSummary = vi.fn().mockReturnValue(summary)

    const [state] = createSelectionStates([makePackageInfo()], getCachedSummary)

    expect(getCachedSummary).toHaveBeenCalledWith('test-pkg', '^1.0.0', 'dependencies')
    expect(state.vulnerability).toBe(summary)
  })

  it('carries deprecation, engines, and version metadata through', () => {
    const [state] = createSelectionStates(
      [
        makePackageInfo({
          deprecated: 'use other-pkg',
          enginesNode: '>=18',
          allVersions: ['1.0.0', '2.0.0'],
        }),
      ],
      noSummary
    )

    expect(state.deprecated).toBe('use other-pkg')
    expect(state.enginesNode).toBe('>=18')
    expect(state.allVersions).toEqual(['1.0.0', '2.0.0'])
  })
})

describe('createPendingSelectionStates', () => {
  it('creates loading placeholders', () => {
    const [state] = createPendingSelectionStates(
      [
        {
          name: 'demo',
          currentVersion: '^1.0.0',
          type: 'dependencies',
          packageJsonPath: '/repo/package.json',
        },
      ],
      noSummary
    )

    expect(state.loadState).toBe('pending')
    expect(state.rangeVersion).toBe('loading')
    expect(state.latestVersion).toBe('loading')
    expect(state.hasRangeUpdate).toBe(false)
    expect(state.hasMajorUpdate).toBe(false)
    expect(state.currentVersion).toBe('1.0.0')
  })

  it('deduplicates pending entries across workspaces', () => {
    const states = createPendingSelectionStates(
      [
        {
          name: 'demo',
          currentVersion: '^1.0.0',
          type: 'dependencies',
          packageJsonPath: '/a/package.json',
        },
        {
          name: 'demo',
          currentVersion: '^1.0.0',
          type: 'dependencies',
          packageJsonPath: '/b/package.json',
        },
      ],
      noSummary
    )

    expect(states).toHaveLength(1)
    expect(states[0].packageJsonPaths).toEqual(['/a/package.json', '/b/package.json'])
  })

  it('restores previous selections for pending states', () => {
    const previous = new Map<string, 'none' | 'range' | 'latest'>([
      ['demo@^1.0.0@dependencies', 'range'],
    ])

    const [state] = createPendingSelectionStates(
      [
        {
          name: 'demo',
          currentVersion: '^1.0.0',
          type: 'dependencies',
          packageJsonPath: '/repo/package.json',
        },
      ],
      noSummary,
      previous
    )

    expect(state.selectedOption).toBe('range')
  })
})

describe('prerelease preservation', () => {
  it('keeps prerelease tags on current/range/latest versions (coerce used to strip them)', () => {
    const [state] = createSelectionStates(
      [
        makePackageInfo({
          currentVersion: '^1.0.0-beta.2',
          rangeVersion: '1.0.0-rc.3',
          latestVersion: '1.0.0-rc.3',
        }),
      ],
      noSummary
    )

    expect(state.currentVersion).toBe('1.0.0-beta.2')
    expect(state.rangeVersion).toBe('1.0.0-rc.3')
    expect(state.latestVersion).toBe('1.0.0-rc.3')
  })

  it('keeps prerelease tags in pending states', () => {
    const [state] = createPendingSelectionStates(
      [
        {
          name: 'next',
          currentVersion: '16.0.0-preview.9',
          type: 'dependencies',
          packageJsonPath: '/repo/package.json',
        },
      ],
      noSummary
    )

    expect(state.currentVersion).toBe('16.0.0-preview.9')
  })

  it('writes a prerelease upgrade with the original range prefix', () => {
    const choices = createUpgradeChoices([
      makeState({
        currentVersionSpecifier: '^1.0.0-beta.2',
        rangeVersion: '1.0.0-rc.3',
        latestVersion: '1.0.0-rc.3',
        selectedOption: 'latest',
      }),
    ])

    expect(choices[0].targetVersion).toBe('^1.0.0-rc.3')
  })

  it('writes a bare prerelease version when saveExact is true', () => {
    const choices = createUpgradeChoices(
      [
        makeState({
          currentVersionSpecifier: '^1.0.0-beta.2',
          rangeVersion: '1.0.0-rc.3',
          latestVersion: '1.0.0-rc.3',
          selectedOption: 'range',
        }),
      ],
      true
    )

    expect(choices[0].targetVersion).toBe('1.0.0-rc.3')
  })
})

describe('ordering and version fallbacks', () => {
  it('sorts scoped packages before unscoped ones', () => {
    const states = createSelectionStates(
      ['zod', '@s/b', 'alpha', '@s/a', 'beta', '@s/c'].map((name) => makePackageInfo({ name })),
      noSummary
    )

    expect(states.map((state) => state.name)).toEqual([
      '@s/a',
      '@s/b',
      '@s/c',
      'alpha',
      'beta',
      'zod',
    ])
  })

  it('keeps a non-coercible current version in pending states', () => {
    const [state] = createPendingSelectionStates(
      [
        {
          name: 'left-pad',
          currentVersion: 'latest',
          type: 'dependencies',
          packageJsonPath: '/repo/package.json',
        },
      ],
      noSummary
    )

    expect(state.currentVersion).toBe('latest')
    expect(state.loadState).toBe('pending')
  })
})
