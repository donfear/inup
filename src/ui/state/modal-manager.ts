export interface ModalState {
  showInfoModal: boolean // Whether to show package info modal
  infoModalRow: number // Which package's info to show
  isLoadingModalInfo: boolean // Whether we're fetching package info for the modal
  infoModalScrollOffset: number // Scroll position within the info modal content
  infoModalSessionId: number // Monotonic id for async modal work isolation
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
    }
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
    this.state.infoModalSessionId += 1
    return this.state.infoModalSessionId
  }

  closeInfoModal(): void {
    this.state.showInfoModal = false
    this.state.infoModalRow = -1
    this.state.isLoadingModalInfo = false
    this.state.infoModalScrollOffset = 0
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
