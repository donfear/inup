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

  it('ignores ignored rows for toggle, select, and bulk', () => {
    const sm = new StateManager(0, 24)
    const states = [ready({ loadState: 'ignored' })]
    sm.toggleSelection(states)
    sm.updateSelection(states, 'right')
    sm.bulkSelectLatest(states)
    sm.bulkSelectMinor(states)
    expect(states[0].selectedOption).toBe('none')
  })
})

const fiveStates = (): PackageSelectionState[] =>
  Array.from({ length: 5 }, (_, i) => ready({ name: `pkg-${i}` }))

describe('StateManager navigation jumps', () => {
  it('navigateBottom selects the last package (flat mode)', () => {
    const sm = new StateManager(0, 24)
    sm.navigateBottom(fiveStates())
    expect(sm.getUIState().currentRow).toBe(4)
  })

  it('navigateTop returns to the first package', () => {
    const sm = new StateManager(0, 24)
    const states = fiveStates()
    sm.navigateBottom(states)
    sm.navigateTop(states)
    expect(sm.getUIState().currentRow).toBe(0)
  })
})

describe('StateManager navigation skips ignored rows', () => {
  // [ignored, ready, ignored, ready]
  const mixed = (): PackageSelectionState[] => [
    ready({ name: 'a', loadState: 'ignored' }),
    ready({ name: 'b' }),
    ready({ name: 'c', loadState: 'ignored' }),
    ready({ name: 'd' }),
  ]

  it('navigateDown skips ignored rows', () => {
    const sm = new StateManager(0, 24)
    const states = mixed()
    sm.ensureCursorOnNavigable(states) // start on first navigable (index 1)
    expect(sm.getUIState().currentRow).toBe(1)
    sm.navigateDown(states)
    expect(sm.getUIState().currentRow).toBe(3)
    sm.navigateDown(states) // wraps to first navigable
    expect(sm.getUIState().currentRow).toBe(1)
  })

  it('navigateTop/Bottom land on first/last navigable', () => {
    const sm = new StateManager(0, 24)
    const states = mixed()
    sm.navigateBottom(states)
    expect(sm.getUIState().currentRow).toBe(3)
    sm.navigateTop(states)
    expect(sm.getUIState().currentRow).toBe(1)
  })

  it('ensureCursorOnNavigable moves off an ignored first row', () => {
    const sm = new StateManager(0, 24)
    sm.ensureCursorOnNavigable(mixed())
    expect(sm.getUIState().currentRow).toBe(1)
  })

  it('all-ignored list leaves the cursor unchanged', () => {
    const sm = new StateManager(0, 24)
    const states = [
      ready({ name: 'a', loadState: 'ignored' }),
      ready({ name: 'b', loadState: 'ignored' }),
    ]
    sm.ensureCursorOnNavigable(states)
    sm.navigateDown(states)
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
