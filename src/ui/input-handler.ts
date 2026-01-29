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
  | { type: 'enter_filter_mode' }
  | { type: 'exit_filter_mode' }
  | { type: 'filter_input'; char: string }
  | { type: 'filter_backspace' }
  | { type: 'toggle_dep_type_filter'; depType: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies' }

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

    // Check for '/' character to enter filter mode (only in normal mode, not in modal or already in filter)
    if (str === '/' && !uiState.showInfoModal && !uiState.filterMode) {
      this.onAction({ type: 'enter_filter_mode' })
      return
    }

    // Handle filter mode input
    if (uiState.filterMode) {
      if (key) {
        switch (key.name) {
          case 'escape':
            this.onAction({ type: 'exit_filter_mode' })
            return

          case 'backspace':
          case 'delete':
            this.onAction({ type: 'filter_backspace' })
            return

          case 'return':
            // Exit filter mode but keep the filter applied
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
          // Show warning and stay in selection mode
          console.log(
            '\n' +
              '\x1b[33m⚠️  No packages selected. Press ↑/↓ to navigate and ←/→ to select versions, or ESC to exit.\x1b[39m'
          )
          // Re-render will happen automatically
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
        // Check if modal is open - if so, close it; otherwise cancel
        if (uiState.showInfoModal) {
          this.onAction({ type: 'toggle_info_modal' })
        } else {
          this.onAction({ type: 'cancel' })
        }
        break
    }
  }

  handleResize(height: number): void {
    this.onAction({ type: 'resize', height })
  }

  private cleanup(): void {
    CursorUtils.show()
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false)
    }
    process.stdin.pause()
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
    CursorUtils.show()
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false)
    }
    process.stdin.pause()
  }
}
