import { InfoModalTab } from '../modal/types'
export type { InfoModalTab }

export interface ModalState {
  showInfoModal: boolean // Whether to show package info modal
  infoModalRow: number // Which package's info to show
  isLoadingModalInfo: boolean // Whether we're fetching package info for the modal
  infoModalScrollOffset: number // Scroll position within the info modal content
  infoModalSessionId: number // Monotonic id for async modal work isolation
  infoModalTab: InfoModalTab // Active tab within the info modal
  showDebugModal: boolean // Whether to show the debug/performance modal
  debugModalScrollOffset: number // Scroll position within the debug modal
  showHelpModal: boolean // Whether to show the keyboard-shortcut help overlay
}

export class ModalManager {
  private state: ModalState

  constructor() {
    this.state = {
      showInfoModal: false,
      infoModalRow: -1,
      isLoadingModalInfo: false,
      infoModalScrollOffset: 0,
      infoModalSessionId: 0,
      infoModalTab: 'info',
      showDebugModal: false,
      debugModalScrollOffset: 0,
      showHelpModal: false,
    }
  }

  getInfoModalTab(): InfoModalTab {
    return this.state.infoModalTab
  }

  setInfoModalTab(tab: InfoModalTab): boolean {
    if (this.state.infoModalTab === tab) return false
    this.state.infoModalTab = tab
    this.state.infoModalScrollOffset = 0
    return true
  }

  isDebugModalOpen(): boolean {
    return this.state.showDebugModal
  }

  toggleDebugModal(): void {
    this.state.showDebugModal = !this.state.showDebugModal
    this.state.debugModalScrollOffset = 0
  }

  isHelpModalOpen(): boolean {
    return this.state.showHelpModal
  }

  toggleHelpModal(): void {
    this.state.showHelpModal = !this.state.showHelpModal
  }

  closeHelpModal(): void {
    this.state.showHelpModal = false
  }

  closeDebugModal(): void {
    this.state.showDebugModal = false
    this.state.debugModalScrollOffset = 0
  }

  scrollDebugModalUp(): boolean {
    if (this.state.debugModalScrollOffset > 0) {
      this.state.debugModalScrollOffset--
      return true
    }
    return false
  }

  scrollDebugModalDown(maxOffset: number): boolean {
    if (this.state.debugModalScrollOffset < maxOffset) {
      this.state.debugModalScrollOffset++
      return true
    }
    return false
  }

  clampDebugModalScrollOffset(maxOffset: number): boolean {
    const nextOffset = Math.max(0, Math.min(this.state.debugModalScrollOffset, maxOffset))
    if (nextOffset === this.state.debugModalScrollOffset) return false
    this.state.debugModalScrollOffset = nextOffset
    return true
  }

  getState(): ModalState {
    return { ...this.state }
  }

  isModalOpen(): boolean {
    return this.state.showInfoModal
  }

  getModalRow(): number {
    return this.state.infoModalRow
  }

  isLoading(): boolean {
    return this.state.isLoadingModalInfo
  }

  getScrollOffset(): number {
    return this.state.infoModalScrollOffset
  }

  getSessionId(): number {
    return this.state.infoModalSessionId
  }

  clampScrollOffset(maxOffset: number): boolean {
    const nextOffset = Math.max(0, Math.min(this.state.infoModalScrollOffset, maxOffset))
    if (nextOffset === this.state.infoModalScrollOffset) {
      return false
    }

    this.state.infoModalScrollOffset = nextOffset
    return true
  }

  resetScroll(): void {
    this.state.infoModalScrollOffset = 0
  }

  scrollModalUp(): boolean {
    if (this.state.infoModalScrollOffset > 0) {
      this.state.infoModalScrollOffset--
      return true
    }
    return false
  }

  scrollModalDown(maxOffset: number): boolean {
    if (this.state.infoModalScrollOffset < maxOffset) {
      this.state.infoModalScrollOffset++
      return true
    }
    return false
  }

  toggleInfoModal(currentRow: number): number {
    if (this.state.showInfoModal) {
      // Close the modal
      this.closeInfoModal()
      return this.state.infoModalSessionId
    }

    // Open the modal for the current package
    this.state.showInfoModal = true
    this.state.infoModalRow = currentRow
    this.state.infoModalScrollOffset = 0
    this.state.isLoadingModalInfo = false
    this.state.infoModalTab = 'info'
    this.state.infoModalSessionId += 1
    return this.state.infoModalSessionId
  }

  closeInfoModal(): void {
    this.state.showInfoModal = false
    this.state.infoModalRow = -1
    this.state.isLoadingModalInfo = false
    this.state.infoModalScrollOffset = 0
    this.state.infoModalTab = 'info'
    this.state.infoModalSessionId += 1
  }

  setModalLoading(isLoading: boolean, sessionId?: number): boolean {
    if (sessionId !== undefined && sessionId !== this.state.infoModalSessionId) {
      return false
    }

    this.state.isLoadingModalInfo = isLoading
    return true
  }
}
