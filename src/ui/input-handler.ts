import { Key } from 'node:readline'
import { PackageSelectionState } from '../types'
import { StateManager } from './state'
import { CursorUtils } from './utils'

export type InputAction =
  | { type: 'navigate_up' }
  | { type: 'navigate_down' }
  | { type: 'select_left' }
  | { type: 'select_right' }
  | { type: 'confirm' }
  | { type: 'bulk_select_minor' }
  | { type: 'bulk_select_latest' }
  | { type: 'bulk_unselect_all' }
  | { type: 'toggle_info_modal' }
  | { type: 'toggle_theme_modal' }
  | { type: 'theme_navigate_up' }
  | { type: 'theme_navigate_down' }
  | { type: 'theme_confirm' }
  | { type: 'cancel' }
  | { type: 'resize'; height: number }
  | { type: 'enter_filter_mode'; preserveQuery?: boolean }
  | { type: 'exit_filter_mode'; clearQuery?: boolean }
  | { type: 'filter_input'; char: string }
  | { type: 'filter_backspace' }
  | {
      type: 'toggle_dep_type_filter'
      depType: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'
    }

export class InputHandler {
  private stateManager: StateManager
  private onAction: (action: InputAction) => void
  private onConfirm: (states: PackageSelectionState[]) => void
  private onCancel: () => void

  constructor(
    stateManager: StateManager,
    onAction: (action: InputAction) => void,
    onConfirm: (states: PackageSelectionState[]) => void,
    onCancel: () => void
  ) {
    this.stateManager = stateManager
    this.onAction = onAction
    this.onConfirm = onConfirm
    this.onCancel = onCancel
  }

  handleKeypress(str: string, key: Key, states: PackageSelectionState[]): void {
    // Guard against undefined or missing key properties
    if (!key && !str) {
      return
    }

    if (key && key.ctrl && key.name === 'c') {
      CursorUtils.show()
      process.exit(0)
    }

    const uiState = this.stateManager.getUIState()

    // Handle theme modal input
    if (uiState.showThemeModal) {
      if (key) {
        switch (key.name) {
          case 'escape':
            // Close theme modal (which also resets theme on cancel)
            this.onAction({ type: 'toggle_theme_modal' })
            return

          case 'return':
            this.onAction({ type: 'theme_confirm' })
            return

          case 'up':
            this.onAction({ type: 'theme_navigate_up' })
            return

          case 'down':
            this.onAction({ type: 'theme_navigate_down' })
            return

          case 't':
          case 'T':
            // Allow 't' to toggle theme modal closed as well
            this.onAction({ type: 'toggle_theme_modal' })
            return

          default:
            return
        }
      }
      return
    }

    // Check for '/' character to handle filter mode (only when not in modal)
    if (str === '/' && !uiState.showInfoModal) {
      if (uiState.filterMode) {
        // Apply search (exit filter mode but keep the filter)
        this.onAction({ type: 'exit_filter_mode' })
      } else {
        // Enter filter mode - preserve query if one exists (to edit it)
        this.onAction({ type: 'enter_filter_mode', preserveQuery: !!uiState.filterQuery })
      }
      return
    }

    // Handle filter mode input
    if (uiState.filterMode) {
      // Check for escape key (either via key.name or raw escape character)
      if ((key && key.name === 'escape') || str === '\x1b') {
        // Escape clears the filter and exits filter mode
        this.onAction({ type: 'exit_filter_mode', clearQuery: true })
        return
      }

      if (key) {
        switch (key.name) {
          case 'backspace':
          case 'delete':
            this.onAction({ type: 'filter_backspace' })
            return

          case 'return':
            // Apply search (exit filter mode but keep the filter)
            this.onAction({ type: 'exit_filter_mode' })
            return

          case 'up':
            this.onAction({ type: 'navigate_up' })
            return

          case 'down':
            this.onAction({ type: 'navigate_down' })
            return

          case 'left':
            this.onAction({ type: 'select_left' })
            return

          case 'right':
            this.onAction({ type: 'select_right' })
            return

          default:
            // Accept printable characters for filter input
            if (str && str.length === 1 && str >= ' ' && str <= '~') {
              this.onAction({ type: 'filter_input', char: str })
            }
            return
        }
      } else {
        // No key object, just accept string input
        if (str && str.length === 1 && str >= ' ' && str <= '~') {
          this.onAction({ type: 'filter_input', char: str })
        }
      }
      return
    }

    // Normal mode (not in filter mode)
    if (!key) {
      return
    }

    switch (key.name) {
      case 'up':
        this.onAction({ type: 'navigate_up' })
        break

      case 'down':
        this.onAction({ type: 'navigate_down' })
        break

      case 'left':
        this.onAction({ type: 'select_left' })
        break

      case 'right':
        this.onAction({ type: 'select_right' })
        break

      case 'return':
        // Check if any packages are selected
        const selectedCount = states.filter((s) => s.selectedOption !== 'none').length
        if (selectedCount === 0) {
          // Do nothing if no packages selected
          return
        }
        this.cleanup()
        this.onConfirm(states)
        return

      case 'm':
      case 'M':
        this.onAction({ type: 'bulk_select_minor' })
        break

      case 'l':
      case 'L':
        this.onAction({ type: 'bulk_select_latest' })
        break

      case 'u':
      case 'U':
        this.onAction({ type: 'bulk_unselect_all' })
        break

      case 'd':
      case 'D':
        if (!uiState.showInfoModal && !uiState.showThemeModal && !uiState.filterMode) {
          this.onAction({ type: 'toggle_dep_type_filter', depType: 'devDependencies' })
        }
        break

      case 'p':
      case 'P':
        if (!uiState.showInfoModal && !uiState.showThemeModal && !uiState.filterMode) {
          this.onAction({ type: 'toggle_dep_type_filter', depType: 'peerDependencies' })
        }
        break

      case 'o':
      case 'O':
        if (!uiState.showInfoModal && !uiState.showThemeModal && !uiState.filterMode) {
          this.onAction({ type: 'toggle_dep_type_filter', depType: 'optionalDependencies' })
        }
        break

      case 'i':
      case 'I':
        this.onAction({ type: 'toggle_info_modal' })
        break

      case 't':
      case 'T':
        this.onAction({ type: 'toggle_theme_modal' })
        break

      case 'escape':
        // Close modal if open
        if (uiState.showInfoModal) {
          this.onAction({ type: 'toggle_info_modal' })
        } else if (uiState.filterQuery) {
          // Clear filter if one is applied
          this.onAction({ type: 'exit_filter_mode', clearQuery: true })
        }
        // Otherwise do nothing - Escape no longer exits the CLI
        break
    }
  }

  handleResize(height: number): void {
    this.onAction({ type: 'resize', height })
  }

  private cleanup(): void {
    CursorUtils.cleanup()
  }
}

export class ConfirmationInputHandler {
  private onConfirm: (confirmed: boolean | null) => void

  constructor(onConfirm: (confirmed: boolean | null) => void) {
    this.onConfirm = onConfirm
  }

  handleKeypress(str: string, key: Key): void {
    // Guard against undefined or missing key properties
    if (!key && !str) {
      return
    }

    if (key && key.ctrl && key.name === 'c') {
      CursorUtils.show()
      process.exit(0)
    }

    if (!key) {
      return
    }

    switch (key.name) {
      case 'y':
      case 'return':
        this.cleanup()
        this.onConfirm(true)
        break

      case 'n':
        this.cleanup()
        this.onConfirm(null) // Go back to selection
        break

      case 'escape':
        this.cleanup()
        this.onConfirm(false) // Cancel
        break
    }
  }

  private cleanup(): void {
    CursorUtils.cleanup()
  }
}
