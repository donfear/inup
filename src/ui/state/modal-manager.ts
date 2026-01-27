export interface ModalState {
  showInfoModal: boolean // Whether to show package info modal
  infoModalRow: number // Which package's info to show
  isLoadingModalInfo: boolean // Whether we're fetching package info for the modal
}

export class ModalManager {
  private state: ModalState

  constructor() {
    this.state = {
      showInfoModal: false,
      infoModalRow: -1,
      isLoadingModalInfo: false,
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

  toggleInfoModal(currentRow: number): void {
    if (this.state.showInfoModal) {
      // Close the modal
      this.closeInfoModal()
    } else {
      // Open the modal for the current package
      this.state.showInfoModal = true
      this.state.infoModalRow = currentRow
    }
  }

  closeInfoModal(): void {
    this.state.showInfoModal = false
    this.state.infoModalRow = -1
    this.state.isLoadingModalInfo = false
  }

  setModalLoading(isLoading: boolean): void {
    this.state.isLoadingModalInfo = isLoading
  }
}
