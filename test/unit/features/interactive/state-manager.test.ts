import { describe, expect, it, vi } from 'vitest'
import { StateManager } from '../../../../src/features/interactive/state'
import { PackageSelectionState, RenderableItem } from '../../../../src/shared/types'
import { makeSelectionState } from '../../../fixtures/selection-state-factory'

// StateManager owns a ThemeManager, which persists through the configManager
// singleton — mock it so tests never touch the user's real config file.
vi.mock('../../../../src/shared/config/user-config', () => ({
  configManager: {
    getTheme: vi.fn(() => null),
    setTheme: vi.fn(),
    getFilters: vi.fn(() => null),
    setFilters: vi.fn(),
  },
}))

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

describe('StateManager.updateSelection', () => {
  const select = (
    initial: PackageSelectionState,
    direction: 'left' | 'right'
  ): PackageSelectionState['selectedOption'] => {
    const sm = new StateManager(0, 24)
    const states = [initial]
    sm.updateSelection(states, direction)
    return states[0].selectedOption
  }

  it('moves right through none → range → latest → none', () => {
    expect(select(ready({ selectedOption: 'none' }), 'right')).toBe('range')
    expect(select(ready({ selectedOption: 'range' }), 'right')).toBe('latest')
    expect(select(ready({ selectedOption: 'latest' }), 'right')).toBe('none')
  })

  it('moves right from none straight to latest when no range update exists', () => {
    expect(select(ready({ selectedOption: 'none', hasRangeUpdate: false }), 'right')).toBe('latest')
  })

  it('wraps right from range to none when no major update exists', () => {
    expect(select(ready({ selectedOption: 'range', hasMajorUpdate: false }), 'right')).toBe('none')
  })

  it('keeps none selected when there are no updates at all', () => {
    expect(
      select(
        ready({ selectedOption: 'none', hasRangeUpdate: false, hasMajorUpdate: false }),
        'right'
      )
    ).toBe('none')
    expect(
      select(
        ready({ selectedOption: 'none', hasRangeUpdate: false, hasMajorUpdate: false }),
        'left'
      )
    ).toBe('none')
  })

  it('moves left through latest → range → none → latest', () => {
    expect(select(ready({ selectedOption: 'latest' }), 'left')).toBe('range')
    expect(select(ready({ selectedOption: 'range' }), 'left')).toBe('none')
    expect(select(ready({ selectedOption: 'none' }), 'left')).toBe('latest')
  })

  it('moves left from latest straight to none when no range update exists', () => {
    expect(select(ready({ selectedOption: 'latest', hasRangeUpdate: false }), 'left')).toBe('none')
  })

  it('wraps left from none to range when no major update exists', () => {
    expect(select(ready({ selectedOption: 'none', hasMajorUpdate: false }), 'left')).toBe('range')
  })

  it('ignores rows that are still loading and empty lists', () => {
    expect(select(ready({ loadState: 'pending' }), 'right')).toBe('none')

    const sm = new StateManager(0, 24)
    sm.updateSelection([], 'right') // must not throw
  })

  it('ignores a cursor that points past the filtered list', () => {
    const sm = new StateManager(0, 24)
    sm.navigateBottom(5) // move the cursor to row 4
    const states = [ready()]

    sm.updateSelection(states, 'right')

    expect(states[0].selectedOption).toBe('none')
  })
})

describe('StateManager bulk selection edge cases', () => {
  it('bulk minor skips rows without a range update and rows still loading', () => {
    const sm = new StateManager(0, 24)
    const states = [ready(), ready({ hasRangeUpdate: false }), ready({ loadState: 'pending' })]

    sm.bulkSelectMinor(states)

    expect(states.map((s) => s.selectedOption)).toEqual(['range', 'none', 'none'])
  })

  it('bulk latest falls back to range when no major update exists', () => {
    const sm = new StateManager(0, 24)
    const states = [
      ready(),
      ready({ hasMajorUpdate: false }),
      ready({ hasMajorUpdate: false, hasRangeUpdate: false, selectedOption: 'none' }),
    ]

    sm.bulkSelectLatest(states)

    expect(states.map((s) => s.selectedOption)).toEqual(['latest', 'range', 'none'])
  })

  it('bulk unselect clears only ready rows', () => {
    const sm = new StateManager(0, 24)
    const states = [
      ready({ selectedOption: 'latest' }),
      ready({ selectedOption: 'range', loadState: 'pending' }),
    ]

    sm.bulkUnselectAll(states)

    expect(states.map((s) => s.selectedOption)).toEqual(['none', 'range'])
  })

  it('bulk operations tolerate empty lists', () => {
    const sm = new StateManager(0, 24)

    sm.bulkSelectMinor([])
    sm.bulkSelectLatest([])
    sm.bulkUnselectAll([])
  })
})

describe('StateManager display state', () => {
  it('derives max visible items from the terminal height', () => {
    const sm = new StateManager(0, 24)

    expect(sm.getUIState().maxVisibleItems).toBe(17) // 24 - 5 header lines - 2
  })

  it('never shrinks below five visible items', () => {
    const sm = new StateManager(0, 8)

    expect(sm.getUIState().maxVisibleItems).toBe(5)
  })

  it('reports whether a terminal height update changed anything', () => {
    const sm = new StateManager(0, 24)

    expect(sm.updateTerminalHeight(24)).toBe(false)
    expect(sm.updateTerminalHeight(40)).toBe(true)
    expect(sm.getUIState().terminalHeight).toBe(40)
    expect(sm.getUIState().maxVisibleItems).toBe(33)
  })

  it('forces a full render after a resize reset', () => {
    const sm = new StateManager(0, 24)
    sm.setInitialRender(false)

    sm.resetForResize(10)

    expect(sm.getUIState().forceFullRender).toBe(true)
  })

  it('stores rendered lines and renderable items', () => {
    const sm = new StateManager(0, 24)
    const items: RenderableItem[] = [
      { type: 'package', state: makeSelectionState(), originalIndex: 0 },
    ]

    sm.setRenderableItems(items)
    sm.markRendered(['line-1', 'line-2'])

    const ui = sm.getUIState()
    expect(ui.renderableItems).toBe(items)
    expect(ui.renderedLines).toEqual(['line-1', 'line-2'])
    expect(sm.packageIndexToVisualIndex(0)).toBe(0)
  })
})

describe('StateManager modal delegation', () => {
  it('opens the info modal for the current row and forces a full render', () => {
    const sm = new StateManager(0, 24)
    sm.navigateDown(3)
    sm.setInitialRender(false)

    const sessionId = sm.toggleInfoModal()

    const ui = sm.getUIState()
    expect(ui.showInfoModal).toBe(true)
    expect(ui.infoModalRow).toBe(1)
    expect(ui.forceFullRender).toBe(true)
    expect(sm.getInfoModalSessionId()).toBe(sessionId)
  })

  it('closes the info modal explicitly', () => {
    const sm = new StateManager(0, 24)
    sm.toggleInfoModal()

    sm.closeInfoModal()

    expect(sm.getUIState().showInfoModal).toBe(false)
  })

  it('ignores loading updates from stale sessions without forcing a render', () => {
    const sm = new StateManager(0, 24)
    const staleId = sm.toggleInfoModal()
    sm.toggleInfoModal() // close — invalidates staleId
    sm.setInitialRender(false)

    expect(sm.setModalLoading(true, staleId)).toBe(false)
    expect(sm.getUIState().forceFullRender).toBe(false)

    expect(sm.setModalLoading(true, sm.getInfoModalSessionId())).toBe(true)
    expect(sm.getUIState().forceFullRender).toBe(true)
  })

  it('scrolls and clamps the info modal viewport', () => {
    const sm = new StateManager(0, 24)
    sm.toggleInfoModal()

    expect(sm.scrollInfoModalUp()).toBe(false)
    expect(sm.scrollInfoModalDown(2)).toBe(true)
    expect(sm.getInfoModalScrollOffset()).toBe(1)

    expect(sm.clampInfoModalScrollOffset(0)).toBe(true)
    expect(sm.getInfoModalScrollOffset()).toBe(0)

    sm.scrollInfoModalDown(2)
    sm.resetInfoModalScroll()
    expect(sm.getInfoModalScrollOffset()).toBe(0)
  })

  it('switches info modal tabs and forces a full render only on change', () => {
    const sm = new StateManager(0, 24)
    sm.toggleInfoModal()
    sm.setInitialRender(false)

    expect(sm.setInfoModalTab('info')).toBe(false)
    expect(sm.getUIState().forceFullRender).toBe(false)

    expect(sm.setInfoModalTab('usedBy')).toBe(true)
    expect(sm.getInfoModalTab()).toBe('usedBy')
    expect(sm.getUIState().forceFullRender).toBe(true)
  })

  it('delegates help modal state and scrolling', () => {
    const sm = new StateManager(0, 24)

    sm.toggleHelpModal()
    expect(sm.getUIState().showHelpModal).toBe(true)

    expect(sm.scrollHelpModalUp()).toBe(false)
    expect(sm.scrollHelpModalDown(2)).toBe(true)
    sm.scrollHelpModalDown(2)
    expect(sm.clampHelpModalScrollOffset(1)).toBe(true)

    sm.closeHelpModal()
    expect(sm.getUIState().showHelpModal).toBe(false)
  })

  it('delegates debug modal state and scrolling', () => {
    const sm = new StateManager(0, 24)

    sm.toggleDebugModal()
    expect(sm.getUIState().showDebugModal).toBe(true)

    expect(sm.scrollDebugModalUp()).toBe(false)
    expect(sm.scrollDebugModalDown(2)).toBe(true)
    sm.scrollDebugModalDown(2)
    expect(sm.clampDebugModalScrollOffset(1)).toBe(true)

    sm.closeDebugModal()
    expect(sm.getUIState().showDebugModal).toBe(false)
  })
})

describe('StateManager filter delegation', () => {
  const named = (name: string) => ready({ name })

  it('filters states by the active query', () => {
    const sm = new StateManager(0, 24)
    sm.enterFilterMode()
    sm.updateFilterQuery('beta')

    const filtered = sm.getFilteredStates([named('alpha'), named('beta'), named('gamma')])

    expect(filtered.map((s) => s.name)).toEqual(['beta'])
  })

  it('resets the cursor when the query changes', () => {
    const sm = new StateManager(0, 24)
    sm.navigateDown(5)

    sm.appendToFilterQuery('a')

    expect(sm.getUIState().currentRow).toBe(0)
    expect(sm.getUIState().filterQuery).toBe('a')

    sm.navigateDown(5)
    sm.deleteFromFilterQuery()
    expect(sm.getUIState().currentRow).toBe(0)
    expect(sm.getUIState().filterQuery).toBe('')
  })

  it('clears the cursor only when exiting filter mode with clearQuery', () => {
    const sm = new StateManager(0, 24)
    sm.enterFilterMode()
    sm.appendToFilterQuery('x')
    sm.navigateDown(5)

    sm.exitFilterMode(false)
    expect(sm.getUIState().filterQuery).toBe('x')
    expect(sm.getUIState().currentRow).toBe(1)

    sm.enterFilterMode(true)
    sm.exitFilterMode(true)
    expect(sm.getUIState().filterQuery).toBe('')
    expect(sm.getUIState().currentRow).toBe(0)
  })

  it('resets the cursor when a dependency-type filter changes', () => {
    const sm = new StateManager(0, 24)
    sm.navigateDown(5)

    sm.toggleDependencyTypeFilter('devDependencies')

    expect(sm.getUIState().currentRow).toBe(0)
    expect(sm.getFilterSnapshot().showDevDependencies).toBe(false)
    expect(sm.getActiveFilterLabel()).toBeTruthy()
  })

  it('toggles the vulnerable-only filter', () => {
    const sm = new StateManager(0, 24)

    expect(sm.isVulnerableFilterActive()).toBe(false)
    sm.toggleVulnerableFilter()
    expect(sm.isVulnerableFilterActive()).toBe(true)
  })
})

describe('StateManager theme delegation', () => {
  it('opens, previews, and confirms themes through the facade', () => {
    const sm = new StateManager(0, 24)

    sm.toggleThemeModal()
    expect(sm.getUIState().showThemeModal).toBe(true)

    sm.previewTheme('gruvbox')
    expect(sm.getThemeManager().getPreviewTheme()).toBe('gruvbox')

    sm.confirmTheme()
    expect(sm.getThemeManager().getCurrentTheme()).toBe('gruvbox')
    expect(sm.getUIState().currentTheme).toBe('gruvbox')

    sm.closeThemeModal()
    expect(sm.getUIState().showThemeModal).toBe(false)
  })
})

describe('StateManager.getUIState', () => {
  it('aggregates every sub-manager into one snapshot', () => {
    const sm = new StateManager(0, 24)

    expect(sm.getUIState()).toEqual(
      expect.objectContaining({
        currentRow: 0,
        previousRow: -1,
        scrollOffset: 0,
        previousScrollOffset: 0,
        maxVisibleItems: 17,
        terminalHeight: 24,
        forceFullRender: true,
        renderedLines: [],
        renderableItems: [],
        showInfoModal: false,
        infoModalRow: -1,
        isLoadingModalInfo: false,
        infoModalScrollOffset: 0,
        infoModalTab: 'info',
        showDebugModal: false,
        debugModalScrollOffset: 0,
        showHelpModal: false,
        helpModalScrollOffset: 0,
        filterMode: false,
        filterQuery: '',
        showThemeModal: false,
        notice: null,
      })
    )
  })
})

describe('StateManager direct notice accessor', () => {
  it('exposes the notice through getNotice', () => {
    const sm = new StateManager(0, 24)

    expect(sm.getNotice()).toBeNull()
    sm.setNotice('heads up')
    expect(sm.getNotice()).toBe('heads up')
  })
})
