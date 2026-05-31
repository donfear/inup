import { describe, it, expect } from 'vitest'
import { createUpgradeChoices } from '../../../src/ui/session/selection-state-builder'
import { PackageSelectionState } from '../../../src/types'

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
})
