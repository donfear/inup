import { describe, expect, it, vi } from 'vitest'
import type { VulnerabilityAuditController } from '../../../../src/features/audit'
import type { PackageInfoModalController } from '../../../../src/features/interactive/controllers'
import type { InputAction } from '../../../../src/features/interactive/input-handler'
import {
  type DispatchContext,
  dispatchAction,
} from '../../../../src/features/interactive/session/action-dispatcher'
import { StateManager } from '../../../../src/features/interactive/state'
import { defaultTheme, themeNames } from '../../../../src/features/interactive/themes'
import type { PackageSelectionState } from '../../../../src/shared/types'
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

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeStates(): PackageSelectionState[] {
  return [
    makeSelectionState({ name: 'pkg-a' }),
    makeSelectionState({ name: 'pkg-b' }),
    makeSelectionState({ name: 'pkg-c' }),
  ]
}

function makeHarness(states = makeStates()) {
  const stateManager = new StateManager(0, 24)

  const packageInfoModalController = {
    cancel: vi.fn(),
    hydrate: vi.fn().mockResolvedValue(null),
    getVersionCount: vi.fn(() => 0),
    loadVersionAtIndex: vi.fn(),
    navigateVersion: vi.fn(() => -1),
    isVersionLoaded: vi.fn(() => true),
  }

  const vulnerabilityAuditController = {
    getProgress: vi.fn(() => ({ total: 0, completed: 0, isRunning: false, hasData: false })),
    enqueueStates: vi.fn(),
  }

  let resolved = false

  const ctx: DispatchContext = {
    stateManager,
    states,
    vulnerabilityDisplayOptions: {},
    packageInfoModalController: packageInfoModalController as unknown as PackageInfoModalController,
    vulnerabilityAuditController:
      vulnerabilityAuditController as unknown as VulnerabilityAuditController,
    isResolved: () => resolved,
    renderInterface: vi.fn(),
    handleCancel: vi.fn(),
    getInfoModalMaxScrollOffset: () => 5,
    getDebugModalMaxScrollOffset: () => 5,
    getHelpModalMaxScrollOffset: () => 5,
  }

  const dispatch = (action: InputAction) => dispatchAction(action, ctx)

  return {
    ctx,
    dispatch,
    states,
    stateManager,
    packageInfoModalController,
    vulnerabilityAuditController,
    render: ctx.renderInterface as ReturnType<typeof vi.fn>,
    handleCancel: ctx.handleCancel as ReturnType<typeof vi.fn>,
    setResolved: (value: boolean) => {
      resolved = value
    },
  }
}

describe('dispatchAction navigation and selection', () => {
  it('moves the cursor and re-renders', () => {
    const { dispatch, stateManager, render } = makeHarness()

    dispatch({ type: 'navigate_down' })

    expect(stateManager.getUIState().currentRow).toBe(1)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('wraps upward from the first row', () => {
    const { dispatch, stateManager } = makeHarness()

    dispatch({ type: 'navigate_up' })

    expect(stateManager.getUIState().currentRow).toBe(2)
  })

  it('jumps to top and bottom', () => {
    const { dispatch, stateManager } = makeHarness()

    dispatch({ type: 'navigate_bottom' })
    expect(stateManager.getUIState().currentRow).toBe(2)

    dispatch({ type: 'navigate_top' })
    expect(stateManager.getUIState().currentRow).toBe(0)
  })

  it('changes the selection with left/right', () => {
    const { dispatch, states } = makeHarness()

    dispatch({ type: 'select_right' })
    expect(states[0].selectedOption).toBe('range')

    dispatch({ type: 'select_left' })
    expect(states[0].selectedOption).toBe('none')
  })

  it('toggles the current row selection', () => {
    const { dispatch, states } = makeHarness()

    dispatch({ type: 'toggle_selection' })

    expect(states[0].selectedOption).toBe('latest')
  })

  it('applies bulk selections to all ready rows', () => {
    const { dispatch, states } = makeHarness()

    dispatch({ type: 'bulk_select_minor' })
    expect(states.every((s) => s.selectedOption === 'range')).toBe(true)

    dispatch({ type: 'bulk_select_latest' })
    expect(states.every((s) => s.selectedOption === 'latest')).toBe(true)

    dispatch({ type: 'bulk_unselect_all' })
    expect(states.every((s) => s.selectedOption === 'none')).toBe(true)
  })
})

describe('dispatchAction notices', () => {
  it('sets the empty-selection notice', () => {
    const { dispatch, stateManager } = makeHarness()

    dispatch({ type: 'notify_empty_selection' })

    expect(stateManager.getUIState().notice).toContain('Nothing selected')
  })

  it('clears the notice on the next action', () => {
    const { dispatch, stateManager } = makeHarness()
    dispatch({ type: 'notify_empty_selection' })

    dispatch({ type: 'navigate_down' })

    expect(stateManager.getUIState().notice).toBeNull()
  })
})

describe('dispatchAction filters', () => {
  it('toggles dependency-type filters and re-renders', () => {
    const { dispatch, stateManager, render } = makeHarness()

    dispatch({ type: 'toggle_dep_type_filter', depType: 'devDependencies' })

    expect(stateManager.getFilterSnapshot().showDevDependencies).toBe(false)
    expect(render).toHaveBeenCalled()
  })

  it('drives filter mode through enter, input, backspace, and exit', () => {
    const { dispatch, stateManager } = makeHarness()

    dispatch({ type: 'enter_filter_mode' })
    expect(stateManager.getUIState().filterMode).toBe(true)

    dispatch({ type: 'filter_input', char: 'p' })
    dispatch({ type: 'filter_input', char: 'k' })
    expect(stateManager.getUIState().filterQuery).toBe('pk')

    dispatch({ type: 'filter_backspace' })
    expect(stateManager.getUIState().filterQuery).toBe('p')

    dispatch({ type: 'exit_filter_mode', clearQuery: true })
    expect(stateManager.getUIState().filterMode).toBe(false)
    expect(stateManager.getUIState().filterQuery).toBe('')
  })
})

describe('dispatchAction theme modal', () => {
  it('swallows interactive actions while the theme modal is open', () => {
    const { dispatch, stateManager, render } = makeHarness()
    dispatch({ type: 'toggle_theme_modal' })
    render.mockClear()

    dispatch({ type: 'navigate_down' })

    expect(stateManager.getUIState().currentRow).toBe(0)
    expect(render).not.toHaveBeenCalled()
  })

  it('still allows non-interactive actions while the theme modal is open', () => {
    const { dispatch, stateManager } = makeHarness()
    dispatch({ type: 'toggle_theme_modal' })

    dispatch({ type: 'theme_navigate_down' })

    expect(stateManager.getThemeManager().getPreviewTheme()).toBe(themeNames[1])
  })

  it('wraps theme navigation at both ends', () => {
    const { dispatch, stateManager } = makeHarness()
    dispatch({ type: 'toggle_theme_modal' })

    dispatch({ type: 'theme_navigate_up' })
    expect(stateManager.getThemeManager().getPreviewTheme()).toBe(themeNames[themeNames.length - 1])

    dispatch({ type: 'theme_navigate_down' })
    expect(stateManager.getThemeManager().getPreviewTheme()).toBe(defaultTheme)
  })

  it('confirms the previewed theme', () => {
    const { dispatch, stateManager } = makeHarness()
    dispatch({ type: 'toggle_theme_modal' })
    dispatch({ type: 'theme_navigate_down' })

    dispatch({ type: 'theme_confirm' })

    expect(stateManager.getThemeManager().getCurrentTheme()).toBe(themeNames[1])
    expect(stateManager.getUIState().showThemeModal).toBe(false)
  })
})

describe('dispatchAction vulnerability audit', () => {
  it('starts a scan when no audit data exists', () => {
    const { dispatch, vulnerabilityAuditController, states } = makeHarness()

    dispatch({ type: 'trigger_audit_scan' })

    expect(vulnerabilityAuditController.enqueueStates).toHaveBeenCalledWith(
      states,
      expect.any(Function)
    )
  })

  it('re-renders from the audit progress callback until resolved', () => {
    const { dispatch, vulnerabilityAuditController, render, setResolved } = makeHarness()
    dispatch({ type: 'trigger_audit_scan' })
    const onUpdate = vulnerabilityAuditController.enqueueStates.mock.calls[0][1] as () => void
    render.mockClear()

    onUpdate()
    expect(render).toHaveBeenCalledTimes(1)

    setResolved(true)
    onUpdate()
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('toggles the vulnerable filter once audit data exists', () => {
    const { dispatch, stateManager, vulnerabilityAuditController } = makeHarness()
    vulnerabilityAuditController.getProgress.mockReturnValue({
      total: 3,
      completed: 3,
      isRunning: false,
      hasData: true,
    })

    dispatch({ type: 'toggle_vulnerable_filter' })

    expect(stateManager.isVulnerableFilterActive()).toBe(true)
    expect(vulnerabilityAuditController.enqueueStates).not.toHaveBeenCalled()
  })

  it('does nothing while a scan is already running', () => {
    const { dispatch, stateManager, vulnerabilityAuditController } = makeHarness()
    vulnerabilityAuditController.getProgress.mockReturnValue({
      total: 3,
      completed: 1,
      isRunning: true,
      hasData: false,
    })

    dispatch({ type: 'trigger_audit_scan' })

    expect(vulnerabilityAuditController.enqueueStates).not.toHaveBeenCalled()
    expect(stateManager.isVulnerableFilterActive()).toBe(false)
  })
})

describe('dispatchAction info modal', () => {
  it('opens the modal, hydrates the package, and chains the first version load', async () => {
    const { dispatch, stateManager, packageInfoModalController, states, render } = makeHarness()
    packageInfoModalController.hydrate.mockResolvedValue({ patch: { deprecated: 'old news' } })
    packageInfoModalController.getVersionCount.mockReturnValue(3)

    dispatch({ type: 'toggle_info_modal' })

    expect(stateManager.getUIState().showInfoModal).toBe(true)
    expect(stateManager.getUIState().isLoadingModalInfo).toBe(true)
    expect(packageInfoModalController.hydrate).toHaveBeenCalledWith(states[0])

    await flushAsync()

    expect(states[0].deprecated).toBe('old news')
    expect(stateManager.getUIState().isLoadingModalInfo).toBe(false)
    expect(packageInfoModalController.loadVersionAtIndex).toHaveBeenCalledWith(
      states[0],
      0,
      expect.any(Function)
    )

    // The version-load callback re-renders while unresolved.
    render.mockClear()
    const onLoaded = packageInfoModalController.loadVersionAtIndex.mock.calls[0][2] as () => void
    onLoaded()
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('skips hydration for rows that are still loading', () => {
    const { dispatch, stateManager, packageInfoModalController } = makeHarness([
      makeSelectionState({ loadState: 'pending' }),
    ])

    dispatch({ type: 'toggle_info_modal' })

    expect(stateManager.getUIState().showInfoModal).toBe(true)
    expect(stateManager.getUIState().isLoadingModalInfo).toBe(false)
    expect(packageInfoModalController.hydrate).not.toHaveBeenCalled()
  })

  it('ignores hydration results from a stale modal session', async () => {
    const { dispatch, packageInfoModalController, states } = makeHarness()
    let resolveHydrate!: (value: { patch: Partial<PackageSelectionState> }) => void
    packageInfoModalController.hydrate.mockReturnValue(
      new Promise((resolve) => {
        resolveHydrate = resolve
      })
    )
    packageInfoModalController.getVersionCount.mockReturnValue(3)

    dispatch({ type: 'toggle_info_modal' }) // open — hydration pending
    dispatch({ type: 'toggle_info_modal' }) // close — invalidates the session

    resolveHydrate({ patch: { deprecated: 'stale' } })
    await flushAsync()

    expect(states[0].deprecated).toBeUndefined()
    expect(packageInfoModalController.loadVersionAtIndex).not.toHaveBeenCalled()
  })

  it('stops loading when hydration fails', async () => {
    const { dispatch, stateManager, packageInfoModalController, render } = makeHarness()
    packageInfoModalController.hydrate.mockRejectedValue(new Error('offline'))

    dispatch({ type: 'toggle_info_modal' })
    render.mockClear()
    await flushAsync()

    expect(stateManager.getUIState().isLoadingModalInfo).toBe(false)
    expect(render).toHaveBeenCalled()
  })

  it('cancels in-flight work when closing the modal', () => {
    const { dispatch, stateManager, packageInfoModalController } = makeHarness()
    dispatch({ type: 'toggle_info_modal' })

    dispatch({ type: 'toggle_info_modal' })

    expect(packageInfoModalController.cancel).toHaveBeenCalled()
    expect(stateManager.getUIState().showInfoModal).toBe(false)
  })

  it('switches between the info and used-by tabs', () => {
    const { dispatch, stateManager } = makeHarness()
    dispatch({ type: 'toggle_info_modal' })

    dispatch({ type: 'switch_info_modal_tab' })
    expect(stateManager.getInfoModalTab()).toBe('usedBy')

    dispatch({ type: 'switch_info_modal_tab' })
    expect(stateManager.getInfoModalTab()).toBe('info')
  })
})

describe('dispatchAction modal scrolling', () => {
  it('re-renders only when the info modal scroll actually moves', () => {
    const { dispatch, render } = makeHarness()
    dispatch({ type: 'toggle_info_modal' })
    render.mockClear()

    dispatch({ type: 'scroll_info_modal_up' }) // already at the top
    expect(render).not.toHaveBeenCalled()

    dispatch({ type: 'scroll_info_modal_down' })
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('re-renders only when the help modal scroll actually moves', () => {
    const { dispatch, render } = makeHarness()
    dispatch({ type: 'toggle_help_modal' })
    render.mockClear()

    dispatch({ type: 'scroll_help_modal_up' })
    expect(render).not.toHaveBeenCalled()

    dispatch({ type: 'scroll_help_modal_down' })
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('re-renders when scrolling back up from a scrolled position', () => {
    const { dispatch, render } = makeHarness()
    dispatch({ type: 'toggle_info_modal' })
    dispatch({ type: 'scroll_info_modal_down' })
    dispatch({ type: 'toggle_help_modal' })
    dispatch({ type: 'scroll_help_modal_down' })
    dispatch({ type: 'toggle_debug_modal' })
    dispatch({ type: 'scroll_debug_modal_down' })
    render.mockClear()

    dispatch({ type: 'scroll_info_modal_up' })
    dispatch({ type: 'scroll_help_modal_up' })
    dispatch({ type: 'scroll_debug_modal_up' })

    expect(render).toHaveBeenCalledTimes(3)
  })

  it('re-renders only when the debug modal scroll actually moves', () => {
    const { dispatch, render } = makeHarness()
    dispatch({ type: 'toggle_debug_modal' })
    render.mockClear()

    dispatch({ type: 'scroll_debug_modal_up' })
    expect(render).not.toHaveBeenCalled()

    dispatch({ type: 'scroll_debug_modal_down' })
    expect(render).toHaveBeenCalledTimes(1)
  })
})

describe('dispatchAction info modal version navigation', () => {
  it('ignores version navigation while the modal is closed', () => {
    const { dispatch, packageInfoModalController, render } = makeHarness()

    dispatch({ type: 'navigate_info_modal_version', direction: 'older' })

    expect(packageInfoModalController.navigateVersion).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })

  it('loads the target version when it is not cached yet', () => {
    const { dispatch, packageInfoModalController, states, render } = makeHarness()
    dispatch({ type: 'toggle_info_modal' })
    packageInfoModalController.navigateVersion.mockReturnValue(1)
    packageInfoModalController.isVersionLoaded.mockReturnValue(false)
    render.mockClear()

    dispatch({ type: 'navigate_info_modal_version', direction: 'older' })

    expect(packageInfoModalController.navigateVersion).toHaveBeenCalledWith(states[0], 'older')
    expect(packageInfoModalController.loadVersionAtIndex).toHaveBeenCalledWith(
      states[0],
      1,
      expect.any(Function)
    )
    expect(render).toHaveBeenCalledTimes(1)

    // The load callback re-renders while unresolved.
    const onLoaded = packageInfoModalController.loadVersionAtIndex.mock.calls[0][2] as () => void
    onLoaded()
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('skips the load when the target version is already cached', () => {
    const { dispatch, packageInfoModalController, render } = makeHarness()
    dispatch({ type: 'toggle_info_modal' })
    packageInfoModalController.navigateVersion.mockReturnValue(1)
    packageInfoModalController.isVersionLoaded.mockReturnValue(true)
    render.mockClear()

    dispatch({ type: 'navigate_info_modal_version', direction: 'newer' })

    expect(packageInfoModalController.loadVersionAtIndex).not.toHaveBeenCalled()
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('does not re-render when navigation hits the end of the list', () => {
    const { dispatch, packageInfoModalController, render } = makeHarness()
    dispatch({ type: 'toggle_info_modal' })
    packageInfoModalController.navigateVersion.mockReturnValue(-1)
    render.mockClear()

    dispatch({ type: 'navigate_info_modal_version', direction: 'newer' })

    expect(render).not.toHaveBeenCalled()
  })
})

describe('dispatchAction resize', () => {
  it('resets navigation when the terminal height changes', () => {
    const { dispatch, stateManager, render } = makeHarness()

    dispatch({ type: 'resize', height: 40 })

    expect(stateManager.getUIState().terminalHeight).toBe(40)
    expect(stateManager.getUIState().forceFullRender).toBe(true)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('forces a full render even when the height is unchanged', () => {
    const { dispatch, stateManager } = makeHarness()
    stateManager.setInitialRender(false)

    dispatch({ type: 'resize', height: 24 })

    expect(stateManager.getUIState().terminalHeight).toBe(24)
    expect(stateManager.getUIState().forceFullRender).toBe(true)
  })
})

describe('dispatchAction cancel', () => {
  it('cancels modal work and delegates without re-rendering', () => {
    const { dispatch, packageInfoModalController, handleCancel, render } = makeHarness()

    dispatch({ type: 'cancel' })

    expect(packageInfoModalController.cancel).toHaveBeenCalled()
    expect(handleCancel).toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })
})

describe('dispatchAction edge paths', () => {
  it('clears the loading state when hydration fails', async () => {
    const { dispatch, packageInfoModalController, stateManager } = makeHarness()
    packageInfoModalController.hydrate.mockRejectedValueOnce(new Error('offline'))

    dispatch({ type: 'toggle_info_modal' })
    await flushAsync()

    expect(stateManager.getUIState().isLoadingModalInfo).toBe(false)
    expect(stateManager.getUIState().showInfoModal).toBe(true)
  })

  it('ignores a hydration failure that lands after the session resolved', async () => {
    const { dispatch, packageInfoModalController, stateManager, setResolved } = makeHarness()
    let rejectHydrate: ((error: Error) => void) | undefined
    packageInfoModalController.hydrate.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectHydrate = reject
        })
    )

    dispatch({ type: 'toggle_info_modal' })
    setResolved(true)
    rejectHydrate!(new Error('too late'))
    await flushAsync()

    // The loading flag is left alone: the session is gone.
    expect(stateManager.getUIState().isLoadingModalInfo).toBe(true)
  })

  it('skips re-rendering version loads that finish after the session resolved', async () => {
    const { dispatch, packageInfoModalController, render, setResolved } = makeHarness()
    packageInfoModalController.getVersionCount.mockReturnValue(2)
    packageInfoModalController.navigateVersion.mockReturnValue(1)
    packageInfoModalController.isVersionLoaded.mockReturnValue(false)
    const callbacks: Array<() => void> = []
    packageInfoModalController.loadVersionAtIndex.mockImplementation(
      (_state: unknown, _index: number, onLoaded: () => void) => {
        callbacks.push(onLoaded)
      }
    )

    dispatch({ type: 'toggle_info_modal' })
    await flushAsync() // hydrate resolves → the initial version load is queued
    dispatch({ type: 'navigate_info_modal_version', direction: 'older' })
    expect(callbacks.length).toBeGreaterThanOrEqual(2)

    setResolved(true)
    const rendersBefore = render.mock.calls.length
    callbacks.forEach((onLoaded) => {
      onLoaded()
    })
    expect(render.mock.calls.length).toBe(rendersBefore)
  })

  it('stops re-rendering when modal scrolling hits the bottom', () => {
    const { dispatch, render } = makeHarness()

    for (let i = 0; i < 7; i++) dispatch({ type: 'scroll_help_modal_down' })
    // The offset is capped at 5, so only the first five presses re-render.
    expect(render).toHaveBeenCalledTimes(5)

    for (let i = 0; i < 7; i++) dispatch({ type: 'scroll_debug_modal_down' })
    expect(render).toHaveBeenCalledTimes(10)
  })

  it('steps the theme preview back to the previous theme', () => {
    const { dispatch, stateManager } = makeHarness()

    dispatch({ type: 'toggle_theme_modal' })
    dispatch({ type: 'theme_navigate_down' })
    dispatch({ type: 'theme_navigate_up' })

    expect(stateManager.getThemeManager().getPreviewTheme()).toBe(themeNames[0])
    expect(stateManager.getThemeManager().getPreviewTheme()).toBe(defaultTheme)
  })
})
