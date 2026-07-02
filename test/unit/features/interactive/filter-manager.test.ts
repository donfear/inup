import { describe, expect, it } from 'vitest'
import { FilterManager } from '../../../../src/features/interactive/state/filter-manager'
import { PackageSelectionState } from '../../../../src/shared/types'

const baseState: PackageSelectionState = {
  name: 'demo-pkg',
  packageJsonPath: '/repo/package.json',
  packageJsonPaths: ['/repo/package.json'],
  currentVersionSpecifier: '^1.0.0',
  currentVersion: '1.0.0',
  rangeVersion: '1.1.0',
  latestVersion: '2.0.0',
  selectedOption: 'none',
  loadState: 'ready',
  hasRangeUpdate: true,
  hasMajorUpdate: true,
  type: 'dependencies',
}

describe('FilterManager text and type filtering', () => {
  it('text filter is case-insensitive', () => {
    const fm = new FilterManager()
    fm.updateFilterQuery('REACT')

    const filtered = fm.getFilteredStates([
      { ...baseState, name: 'React', type: 'dependencies' },
      { ...baseState, name: 'vue', type: 'dependencies' },
    ])
    expect(filtered.map((s) => s.name)).toEqual(['React'])
  })

  it('toggling a dep type off removes it from results', () => {
    const fm = new FilterManager()
    fm.toggleDependencyType('devDependencies')

    const filtered = fm.getFilteredStates([
      { ...baseState, name: 'react', type: 'dependencies' },
      { ...baseState, name: 'typescript', type: 'devDependencies' },
    ])
    expect(filtered.map((s) => s.name)).toEqual(['react'])
  })

  it('toggling all types off returns empty list', () => {
    const fm = new FilterManager()
    ;(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const).forEach(
      (t) => fm.toggleDependencyType(t)
    )
    expect(fm.getFilteredStates([
      { ...baseState, name: 'a', type: 'dependencies' },
      { ...baseState, name: 'b', type: 'devDependencies' },
    ])).toHaveLength(0)
  })

  it('deleteFromFilterQuery removes last character and does nothing on empty', () => {
    const fm = new FilterManager()
    fm.enterFilterMode()
    fm.appendToFilterQuery('r')
    fm.appendToFilterQuery('e')
    fm.deleteFromFilterQuery()
    expect(fm.getFilterQuery()).toBe('r')
    fm.deleteFromFilterQuery()
    fm.deleteFromFilterQuery() // already empty — should not throw
    expect(fm.getFilterQuery()).toBe('')
  })

  it('getActiveFilterLabel returns None when all types are hidden', () => {
    const fm = new FilterManager()
    ;(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const).forEach(
      (t) => fm.toggleDependencyType(t)
    )
    expect(fm.getActiveFilterLabel()).toBe('None')
  })

  it('getActiveFilterLabel appends "(vulnerable only)" when vuln filter is active', () => {
    const fm = new FilterManager()
    fm.toggleVulnerableFilter()
    expect(fm.getActiveFilterLabel()).toContain('(vulnerable only)')
  })

  it('getState returns a snapshot independent of subsequent mutations', () => {
    const fm = new FilterManager()
    const before = fm.getState()
    fm.toggleVulnerableFilter()
    expect(before.showOnlyVulnerable).toBe(false)
    expect(fm.getState().showOnlyVulnerable).toBe(true)
  })
})

describe('FilterManager vulnerability filtering', () => {
  it('excludes hidden peer and optional vulnerabilities from vulnerable-only results', () => {
    const filterManager = new FilterManager()
    filterManager.toggleVulnerableFilter()

    const filtered = filterManager.getFilteredStates([
      {
        ...baseState,
        name: 'direct',
        type: 'dependencies',
        vulnerability: {
          count: 1,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-direct',
          advisories: [],
        },
      },
      {
        ...baseState,
        name: 'peer',
        type: 'peerDependencies',
        vulnerability: {
          count: 1,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-peer',
          advisories: [],
        },
      },
      {
        ...baseState,
        name: 'optional',
        type: 'optionalDependencies',
        vulnerability: {
          count: 1,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-optional',
          advisories: [],
        },
      },
    ])

    expect(filtered.map((state) => state.name)).toEqual(['direct'])
  })

  it('includes peer and optional vulnerabilities when explicitly enabled', () => {
    const filterManager = new FilterManager()
    filterManager.toggleVulnerableFilter()

    const filtered = filterManager.getFilteredStates(
      [
        {
          ...baseState,
          name: 'peer',
          type: 'peerDependencies',
          vulnerability: {
            count: 1,
            highestSeverity: 'high',
            detailsUrl: 'https://github.com/advisories/GHSA-peer',
            advisories: [],
          },
        },
        {
          ...baseState,
          name: 'optional',
          type: 'optionalDependencies',
          vulnerability: {
            count: 1,
            highestSeverity: 'high',
            detailsUrl: 'https://github.com/advisories/GHSA-optional',
            advisories: [],
          },
        },
      ],
      {
        showPeerDependencyVulnerabilities: true,
        showOptionalDependencyVulnerabilities: true,
      }
    )

    expect(filtered.map((state) => state.name)).toEqual(['peer', 'optional'])
  })
})

describe('FilterManager persistence', () => {
  it('seeds from persisted filters, defaulting unspecified toggles to visible', () => {
    const fm = new FilterManager({ showDevDependencies: false, showOnlyVulnerable: true })
    const state = fm.getState()
    expect(state.showDevDependencies).toBe(false)
    expect(state.showOnlyVulnerable).toBe(true)
    expect(state.showDependencies).toBe(true)
  })

  it('getPersistableState excludes transient search state', () => {
    const fm = new FilterManager()
    fm.enterFilterMode()
    fm.appendToFilterQuery('react')
    fm.toggleVulnerableFilter()

    const persisted = fm.getPersistableState()
    expect(persisted).toEqual({
      showDependencies: true,
      showDevDependencies: true,
      showPeerDependencies: true,
      showOptionalDependencies: true,
      showOnlyVulnerable: true,
    })
    expect('filterQuery' in persisted).toBe(false)
  })
})
