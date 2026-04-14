export interface ModalState {
  showInfoModal: boolean // Whether to show package info modal
  infoModalRow: number // Which package's info to show
  isLoadingModalInfo: boolean // Whether we're fetching package info for the modal
  infoModalScrollOffset: number // Scroll position within the info modal content
}

export class ModalManager {
  private state: ModalState

  constructor() {
    this.state = {
      showInfoModal: false,
      infoModalRow: -1,
      isLoadingModalInfo: false,
      infoModalScrollOffset: 0,
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

  scrollModalUp(): void {
    if (this.state.infoModalScrollOffset > 0) {
      this.state.infoModalScrollOffset--
    }
  }

  scrollModalDown(maxOffset: number): void {
    if (this.state.infoModalScrollOffset < maxOffset) {
      this.state.infoModalScrollOffset++
    }
  }

  toggleInfoModal(currentRow: number): void {
    if (this.state.showInfoModal) {
      // Close the modal
      this.closeInfoModal()
    } else {
      // Open the modal for the current package
      this.state.showInfoModal = true
      this.state.infoModalRow = currentRow
      this.state.infoModalScrollOffset = 0
    }
  }

  closeInfoModal(): void {
    this.state.showInfoModal = false
    this.state.infoModalRow = -1
    this.state.isLoadingModalInfo = false
    this.state.infoModalScrollOffset = 0
  }

  setModalLoading(isLoading: boolean): void {
    this.state.isLoadingModalInfo = isLoading
  }
}
