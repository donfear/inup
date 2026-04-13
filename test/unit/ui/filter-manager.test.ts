import { describe, expect, it } from 'vitest'
import { FilterManager } from '../../../src/ui/state/filter-manager'
import { PackageSelectionState } from '../../../src/types'

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
