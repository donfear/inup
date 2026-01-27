import { Key } from 'node:readline'
import { PackageSelectionState } from '../types'
import { StateManager } from './state'
import { CursorUtils } from './cursor'

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
  | { type: 'cancel' }
  | { type: 'resize'; height: number }

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

    if (key.ctrl && key.name === 'c') {
      CursorUtils.show()
      process.exit(0)
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

      case 'i':
      case 'I':
        this.onAction({ type: 'toggle_info_modal' })
        break

      case 'escape':
        // Check if modal is open - if so, close it; otherwise cancel
        const uiState = this.stateManager.getUIState()
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

    if (key.ctrl && key.name === 'c') {
      CursorUtils.show()
      process.exit(0)
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
