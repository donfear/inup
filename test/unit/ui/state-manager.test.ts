import { describe, expect, it } from 'vitest'
import { StateManager } from '../../../src/ui/state'
import { PackageSelectionState } from '../../../src/types'

const ready = (over: Partial<PackageSelectionState> = {}): PackageSelectionState => ({
  name: 'pkg',
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
  ...over,
})

describe('StateManager.toggleSelection', () => {
  it('selects the best available update when none is selected', () => {
    const sm = new StateManager(0, 24)
    const states = [ready()]
    sm.toggleSelection(states)
    expect(states[0].selectedOption).toBe('latest')
  })

  it('clears the selection when one is already set', () => {
    const sm = new StateManager(0, 24)
    const states = [ready({ selectedOption: 'latest' })]
    sm.toggleSelection(states)
    expect(states[0].selectedOption).toBe('none')
  })

  it('falls back to range when no major update exists', () => {
    const sm = new StateManager(0, 24)
    const states = [ready({ hasMajorUpdate: false })]
    sm.toggleSelection(states)
    expect(states[0].selectedOption).toBe('range')
  })

  it('ignores non-ready rows', () => {
    const sm = new StateManager(0, 24)
    const states = [ready({ loadState: 'pending' })]
    sm.toggleSelection(states)
    expect(states[0].selectedOption).toBe('none')
  })
})

describe('StateManager navigation jumps', () => {
  it('navigateBottom selects the last package (flat mode)', () => {
    const sm = new StateManager(0, 24)
    sm.navigateBottom(5)
    expect(sm.getUIState().currentRow).toBe(4)
  })

  it('navigateTop returns to the first package', () => {
    const sm = new StateManager(0, 24)
    sm.navigateBottom(5)
    sm.navigateTop(5)
    expect(sm.getUIState().currentRow).toBe(0)
  })
})

describe('StateManager notice', () => {
  it('stores and clears a transient notice', () => {
    const sm = new StateManager(0, 24)
    expect(sm.getUIState().notice).toBeNull()
    sm.setNotice('Nothing selected')
    expect(sm.getUIState().notice).toBe('Nothing selected')
    sm.clearNotice()
    expect(sm.getUIState().notice).toBeNull()
  })
})

describe('StateManager filter persistence', () => {
  it('seeds filters from persisted state and snapshots them back', () => {
    const sm = new StateManager(0, 24, { showDevDependencies: false, showOnlyVulnerable: true })
    const snapshot = sm.getFilterSnapshot()
    expect(snapshot.showDevDependencies).toBe(false)
    expect(snapshot.showOnlyVulnerable).toBe(true)
    expect(snapshot.showDependencies).toBe(true)
  })
})
