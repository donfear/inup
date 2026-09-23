import type { PackageSelectionState, VulnerabilityDisplayOptions } from '../../../shared/types'
import type { VulnerabilityAuditController } from '../../audit'
import type { PackageInfoModalController } from '../controllers'
import type { InputAction } from '../input-handler'
import type { StateManager } from '../state'
import { themeNames, themes } from '../themes'

const INTERACTIVE_ACTIONS = new Set([
  'navigate_up',
  'navigate_down',
  'navigate_top',
  'navigate_bottom',
  'navigate_page_up',
  'navigate_page_down',
  'select_left',
  'select_right',
  'toggle_selection',
  'bulk_select_minor',
  'bulk_select_latest',
  'bulk_unselect_all',
  'toggle_dep_type_filter',
  'toggle_vulnerable_filter',
  'toggle_cooldown_held_filter',
])

export type DispatchContext = {
  stateManager: StateManager
  states: PackageSelectionState[]
  vulnerabilityDisplayOptions: VulnerabilityDisplayOptions
  packageInfoModalController: PackageInfoModalController
  vulnerabilityAuditController: VulnerabilityAuditController
  isResolved: () => boolean
  /** Coalesced render for async continuations; the session renders keyboard actions itself. */
  requestRender: () => void
  handleCancel: () => void
  getInfoModalMaxScrollOffset: () => number
  getDebugModalMaxScrollOffset: () => number
  getHelpModalMaxScrollOffset: () => number
}

/** Applies one input action. Returns true when the view must be redrawn. */
export function dispatchAction(action: InputAction, ctx: DispatchContext): boolean {
  const {
    stateManager,
    states,
    vulnerabilityDisplayOptions,
    packageInfoModalController,
    vulnerabilityAuditController,
    isResolved,
    requestRender,
    handleCancel,
    getInfoModalMaxScrollOffset,
    getDebugModalMaxScrollOffset,
    getHelpModalMaxScrollOffset,
  } = ctx

  const uiState = stateManager.getUIState()
  const filteredStates = stateManager.getFilteredStates(states, vulnerabilityDisplayOptions)

  // Any deliberate action clears a one-shot status notice (except the action that sets it).
  if (action.type !== 'notify_empty_selection') {
    stateManager.clearNotice()
  }

  if (uiState.showThemeModal && INTERACTIVE_ACTIONS.has(action.type)) return false

  // Shared by `s` (audit) and `v` (vulnerable filter): run the scan if we have no
  // data yet, otherwise toggle the vulnerable-only filter.
  const auditOrToggleVulnerable = () => {
    const auditProgress = vulnerabilityAuditController.getProgress()
    if (auditProgress.hasData) {
      stateManager.toggleVulnerableFilter()
    } else if (!auditProgress.isRunning) {
      vulnerabilityAuditController.enqueueStates(states, requestRender)
    }
  }

  switch (action.type) {
    case 'navigate_up':
      stateManager.navigateUp(filteredStates.length)
      break
    case 'navigate_down':
      stateManager.navigateDown(filteredStates.length)
      break
    case 'navigate_top':
      stateManager.navigateTop(filteredStates.length)
      break
    case 'navigate_bottom':
      stateManager.navigateBottom(filteredStates.length)
      break
    case 'navigate_page_up':
      stateManager.navigatePageUp(filteredStates.length)
      break
    case 'navigate_page_down':
      stateManager.navigatePageDown(filteredStates.length)
      break
    case 'select_left':
      stateManager.updateSelection(filteredStates, 'left')
      break
    case 'select_right':
      stateManager.updateSelection(filteredStates, 'right')
      break
    case 'toggle_selection':
      stateManager.toggleSelection(filteredStates)
      break
    case 'notify_empty_selection':
      stateManager.setNotice('Nothing selected — use ←/→ or Space to choose updates, then Enter')
      break
    case 'bulk_select_minor':
      stateManager.bulkSelectMinor(filteredStates)
      break
    case 'bulk_select_latest':
      stateManager.bulkSelectLatest(filteredStates)
      break
    case 'bulk_unselect_all':
      // Every row, not just the visible ones: Enter applies hidden selections too.
      stateManager.bulkUnselectAll(states)
      break
    case 'toggle_dep_type_filter':
      stateManager.toggleDependencyTypeFilter(action.depType)
      break
    case 'toggle_info_modal':
      if (!uiState.showInfoModal) {
        const modalSessionId = stateManager.toggleInfoModal()
        const currentState = filteredStates[uiState.currentRow]
        const canFetchMetadata = currentState !== undefined
        stateManager.setModalLoading(canFetchMetadata, modalSessionId)

        if (currentState) {
          packageInfoModalController
            .hydrate(currentState)
            .then((update) => {
              if (isResolved() || stateManager.getInfoModalSessionId() !== modalSessionId) return

              if (update) Object.assign(currentState, update.patch)

              stateManager.setModalLoading(false, modalSessionId)
              requestRender()

              if (
                stateManager.getInfoModalSessionId() === modalSessionId &&
                packageInfoModalController.getVersionCount(currentState) > 0
              ) {
                void packageInfoModalController.loadVersionAtIndex(currentState, 0, requestRender)
              }
            })
            .catch(() => {
              if (isResolved() || stateManager.getInfoModalSessionId() !== modalSessionId) return
              stateManager.setModalLoading(false, modalSessionId)
              requestRender()
            })
        }
      } else {
        packageInfoModalController.cancel()
        stateManager.toggleInfoModal()
      }
      return true
    case 'scroll_info_modal_up':
      if (!stateManager.scrollInfoModalUp()) return false
      break
    case 'scroll_info_modal_down':
      if (!stateManager.scrollInfoModalDown(getInfoModalMaxScrollOffset())) return false
      break
    case 'toggle_debug_modal':
      stateManager.toggleDebugModal()
      break
    case 'toggle_help_modal':
      stateManager.toggleHelpModal()
      break
    case 'scroll_help_modal_up':
      if (!stateManager.scrollHelpModalUp()) return false
      break
    case 'scroll_help_modal_down':
      if (!stateManager.scrollHelpModalDown(getHelpModalMaxScrollOffset())) return false
      break
    case 'scroll_debug_modal_up':
      if (!stateManager.scrollDebugModalUp()) return false
      break
    case 'scroll_debug_modal_down':
      if (!stateManager.scrollDebugModalDown(getDebugModalMaxScrollOffset())) return false
      break
    case 'switch_info_modal_tab': {
      const nextTab = stateManager.getInfoModalTab() === 'info' ? 'usedBy' : 'info'
      stateManager.setInfoModalTab(nextTab)
      break
    }
    case 'navigate_info_modal_version': {
      if (uiState.infoModalRow >= 0 && uiState.infoModalRow < filteredStates.length) {
        const currentState = filteredStates[uiState.infoModalRow]
        const newIndex = packageInfoModalController.navigateVersion(currentState, action.direction)
        if (newIndex >= 0) {
          stateManager.resetInfoModalScroll()
          if (!packageInfoModalController.isVersionLoaded(currentState, newIndex)) {
            void packageInfoModalController.loadVersionAtIndex(
              currentState,
              newIndex,
              requestRender
            )
          }
        } else {
          return false
        }
      } else {
        return false
      }
      break
    }
    case 'enter_filter_mode':
      stateManager.enterFilterMode(action.preserveQuery)
      break
    case 'exit_filter_mode':
      stateManager.exitFilterMode(action.clearQuery)
      break
    case 'filter_input':
      stateManager.appendToFilterQuery(action.char)
      break
    case 'filter_backspace':
      stateManager.deleteFromFilterQuery()
      break
    case 'resize': {
      const heightChanged = stateManager.updateTerminalHeight(action.height)
      if (heightChanged) {
        stateManager.resetForResize(filteredStates.length)
      } else {
        stateManager.setInitialRender(true)
      }
      break
    }
    case 'toggle_theme_modal':
      stateManager.toggleThemeModal()
      break
    case 'theme_navigate_up': {
      const themeManager = stateManager.getThemeManager()
      const currentIndex = themeNames.indexOf(themeManager.getPreviewTheme())
      const themeArray = Object.keys(themes)
      const nextIndex = currentIndex > 0 ? currentIndex - 1 : themeArray.length - 1
      stateManager.previewTheme(themeArray[nextIndex])
      break
    }
    case 'theme_navigate_down': {
      const themeManager = stateManager.getThemeManager()
      const currentIndex = themeNames.indexOf(themeManager.getPreviewTheme())
      const themeArray = Object.keys(themes)
      const nextIndex = currentIndex < themeArray.length - 1 ? currentIndex + 1 : 0
      stateManager.previewTheme(themeArray[nextIndex])
      break
    }
    case 'theme_confirm':
      stateManager.confirmTheme()
      break
    case 'trigger_audit_scan':
      auditOrToggleVulnerable()
      break
    case 'toggle_vulnerable_filter':
      auditOrToggleVulnerable()
      break
    case 'toggle_cooldown_held_filter':
      stateManager.toggleCooldownHeldFilter()
      break
    case 'quit':
      packageInfoModalController.cancel()
      handleCancel()
      return false
  }

  return true
}
