import { describe, it, expect } from 'vitest'
import {
  createUpgradeChoices,
  createIgnoredSelectionStates,
} from '../../../src/ui/session/selection-state-builder'
import { DependencyEntry, PackageSelectionState } from '../../../src/types'

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

  it('excludes ignored states even if somehow marked selected', () => {
    const choices = createUpgradeChoices([
      makeState({ loadState: 'ignored', selectedOption: 'latest' }),
    ])

    expect(choices).toHaveLength(0)
  })
})

describe('createIgnoredSelectionStates', () => {
  const dep = (over: Partial<DependencyEntry> = {}): DependencyEntry => ({
    name: 'lodash',
    version: '^4.17.0',
    type: 'dependencies',
    packageJsonPath: '/repo/package.json',
    ...over,
  })

  it('builds display-only states with loadState ignored and no selection', () => {
    const states = createIgnoredSelectionStates([dep()])

    expect(states).toHaveLength(1)
    expect(states[0].loadState).toBe('ignored')
    expect(states[0].selectedOption).toBe('none')
    expect(states[0].hasRangeUpdate).toBe(false)
    expect(states[0].hasMajorUpdate).toBe(false)
    expect(states[0].currentVersionSpecifier).toBe('^4.17.0')
  })

  it('dedupes and sorts scoped-first then alphabetical', () => {
    const states = createIgnoredSelectionStates([
      dep({ name: 'zod' }),
      dep({ name: 'lodash' }),
      dep({ name: '@scope/pkg' }),
      dep({ name: 'lodash' }), // duplicate name@version@type
    ])

    expect(states.map((s) => s.name)).toEqual(['@scope/pkg', 'lodash', 'zod'])
  })
})
