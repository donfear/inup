import { PackageSelectionState, VulnerabilityDisplayOptions } from '../../../shared/types'
import { StateManager } from '../state'
import { InputAction } from '../input-handler'
import { PackageInfoModalController } from '../controllers'
import { VulnerabilityAuditController } from '../../audit'
import { themeNames, themes } from '../themes'

const INTERACTIVE_ACTIONS = new Set([
  'navigate_up',
  'navigate_down',
  'navigate_top',
  'navigate_bottom',
  'select_left',
  'select_right',
  'toggle_selection',
  'bulk_select_minor',
  'bulk_select_latest',
  'bulk_unselect_all',
  'toggle_dep_type_filter',
  'toggle_vulnerable_filter',
])

export type DispatchContext = {
  stateManager: StateManager
  states: PackageSelectionState[]
  vulnerabilityDisplayOptions: VulnerabilityDisplayOptions
  packageInfoModalController: PackageInfoModalController
  vulnerabilityAuditController: VulnerabilityAuditController
  isResolved: () => boolean
  renderInterface: () => void
  handleCancel: () => void
  getInfoModalMaxScrollOffset: () => number
  getDebugModalMaxScrollOffset: () => number
  getHelpModalMaxScrollOffset: () => number
}

export function dispatchAction(action: InputAction, ctx: DispatchContext): void {
  const {
    stateManager,
    states,
    vulnerabilityDisplayOptions,
    packageInfoModalController,
    vulnerabilityAuditController,
    isResolved,
    renderInterface,
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

  if (uiState.showThemeModal && INTERACTIVE_ACTIONS.has(action.type)) return

  // Shared by `s` (audit) and `v` (vulnerable filter): run the scan if we have no
  // data yet, otherwise toggle the vulnerable-only filter.
  const auditOrToggleVulnerable = () => {
    const auditProgress = vulnerabilityAuditController.getProgress()
    if (auditProgress.hasData) {
      stateManager.toggleVulnerableFilter()
    } else if (!auditProgress.isRunning) {
      vulnerabilityAuditController.enqueueStates(states, () => {
        if (!isResolved()) renderInterface()
      })
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
      stateManager.bulkUnselectAll(filteredStates)
      break
    case 'toggle_dep_type_filter':
      stateManager.toggleDependencyTypeFilter(action.depType)
      break
    case 'toggle_info_modal':
      if (!uiState.showInfoModal) {
        const modalSessionId = stateManager.toggleInfoModal()
        const currentState = filteredStates[uiState.currentRow]
        const canFetchMetadata = currentState?.loadState === 'ready'
        stateManager.setModalLoading(canFetchMetadata, modalSessionId)
        renderInterface()

        if (currentState && canFetchMetadata) {
          packageInfoModalController
            .hydrate(currentState)
            .then((update) => {
              if (isResolved() || stateManager.getInfoModalSessionId() !== modalSessionId) return

              if (update) Object.assign(currentState, update.patch)

              stateManager.setModalLoading(false, modalSessionId)
              renderInterface()

              if (
                stateManager.getInfoModalSessionId() === modalSessionId &&
                packageInfoModalController.getVersionCount(currentState) > 0
              ) {
                packageInfoModalController.loadVersionAtIndex(currentState, 0, () => {
                  if (!isResolved()) renderInterface()
                })
              }
            })
            .catch(() => {
              if (isResolved() || stateManager.getInfoModalSessionId() !== modalSessionId) return
              stateManager.setModalLoading(false, modalSessionId)
              renderInterface()
            })
        }
      } else {
        packageInfoModalController.cancel()
        stateManager.toggleInfoModal()
        renderInterface()
      }
      return
    case 'scroll_info_modal_up':
      if (!stateManager.scrollInfoModalUp()) return
      break
    case 'scroll_info_modal_down':
      if (!stateManager.scrollInfoModalDown(getInfoModalMaxScrollOffset())) return
      break
    case 'toggle_debug_modal':
      stateManager.toggleDebugModal()
      break
    case 'toggle_help_modal':
      stateManager.toggleHelpModal()
      break
    case 'scroll_help_modal_up':
      if (!stateManager.scrollHelpModalUp()) return
      break
    case 'scroll_help_modal_down':
      if (!stateManager.scrollHelpModalDown(getHelpModalMaxScrollOffset())) return
      break
    case 'scroll_debug_modal_up':
      if (!stateManager.scrollDebugModalUp()) return
      break
    case 'scroll_debug_modal_down':
      if (!stateManager.scrollDebugModalDown(getDebugModalMaxScrollOffset())) return
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
            packageInfoModalController.loadVersionAtIndex(currentState, newIndex, () => {
              if (!isResolved()) renderInterface()
            })
          }
        } else {
          return
        }
      } else {
        return
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
    case 'cancel':
      packageInfoModalController.cancel()
      handleCancel()
      return
  }

  renderInterface()
}
