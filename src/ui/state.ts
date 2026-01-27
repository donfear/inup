import { PackageSelectionState, RenderableItem } from '../types'

export interface UIState {
  currentRow: number // Index into states array (package index)
  previousRow: number
  scrollOffset: number // Scroll offset in visual rows (includes headers/spacers)
  previousScrollOffset: number
  maxVisibleItems: number
  terminalHeight: number
  isInitialRender: boolean
  renderedLines: string[]
  renderableItems: RenderableItem[]
  showInfoModal: boolean // Whether to show package info modal
  infoModalRow: number // Which package's info to show
  isLoadingModalInfo: boolean // Whether we're fetching package info for the modal
  filterMode: boolean // Whether we're in filter/search input mode
  filterQuery: string // Current filter/search query
}

export class StateManager {
  private uiState: UIState
  private readonly headerLines = 5 // title (with label) + empty + 1 instruction line + status + empty

  constructor(initialRow: number = 0, terminalHeight: number = 24) {
    this.uiState = {
      currentRow: initialRow,
      previousRow: -1,
      scrollOffset: 0,
      previousScrollOffset: 0,
      maxVisibleItems: Math.max(5, terminalHeight - this.headerLines - 2),
      terminalHeight,
      isInitialRender: true,
      renderedLines: [],
      renderableItems: [],
      showInfoModal: false,
      infoModalRow: -1,
      isLoadingModalInfo: false,
      filterMode: false,
      filterQuery: '',
    }
  }

  getUIState(): UIState {
    return { ...this.uiState }
  }

  setRenderableItems(items: RenderableItem[]): void {
    this.uiState.renderableItems = items
  }

  // Convert package index to visual row index in renderable items
  packageIndexToVisualIndex(packageIndex: number): number {
    // If no renderable items (flat mode), visual index equals package index
    if (this.uiState.renderableItems.length === 0) {
      return packageIndex
    }

    // Otherwise search in renderable items (grouped mode)
    for (let i = 0; i < this.uiState.renderableItems.length; i++) {
      const item = this.uiState.renderableItems[i]
      if (item.type === 'package' && item.originalIndex === packageIndex) {
        return i
      }
    }
    return 0
  }

  // Find the next navigable package index in the given direction
  private findNextPackageIndex(
    currentPackageIndex: number,
    direction: 'up' | 'down',
    totalPackages: number
  ): number {
    if (this.uiState.renderableItems.length === 0) {
      // Fallback to simple navigation if no renderable items
      if (direction === 'up') {
        return currentPackageIndex <= 0 ? totalPackages - 1 : currentPackageIndex - 1
      } else {
        return currentPackageIndex >= totalPackages - 1 ? 0 : currentPackageIndex + 1
      }
    }

    // Find current visual index
    const currentVisualIndex = this.packageIndexToVisualIndex(currentPackageIndex)

    // Get all package items with their visual indices
    const packageItems: { visualIndex: number; packageIndex: number }[] = []
    for (let i = 0; i < this.uiState.renderableItems.length; i++) {
      const item = this.uiState.renderableItems[i]
      if (item.type === 'package') {
        packageItems.push({ visualIndex: i, packageIndex: item.originalIndex })
      }
    }

    if (packageItems.length === 0) return currentPackageIndex

    // Find current position in packageItems
    const currentPos = packageItems.findIndex((p) => p.packageIndex === currentPackageIndex)
    if (currentPos === -1) return packageItems[0].packageIndex

    // Navigate with wrap-around at boundaries
    if (direction === 'up') {
      const newPos = currentPos <= 0 ? packageItems.length - 1 : currentPos - 1
      return packageItems[newPos].packageIndex
    } else {
      const newPos = currentPos >= packageItems.length - 1 ? 0 : currentPos + 1
      return packageItems[newPos].packageIndex
    }
  }

  updateTerminalHeight(newHeight: number): boolean {
    const newMaxVisibleItems = Math.max(5, newHeight - this.headerLines - 2)

    if (
      newHeight !== this.uiState.terminalHeight ||
      newMaxVisibleItems !== this.uiState.maxVisibleItems
    ) {
      this.uiState.terminalHeight = newHeight
      this.uiState.maxVisibleItems = newMaxVisibleItems
      return true // Changed
    }
    return false // No change
  }

  navigateUp(totalItems: number): void {
    if (totalItems === 0) return
    this.uiState.previousRow = this.uiState.currentRow
    this.uiState.currentRow = this.findNextPackageIndex(this.uiState.currentRow, 'up', totalItems)
    this.ensureVisible(this.uiState.currentRow, totalItems)
  }

  navigateDown(totalItems: number): void {
    if (totalItems === 0) return
    this.uiState.previousRow = this.uiState.currentRow
    this.uiState.currentRow = this.findNextPackageIndex(this.uiState.currentRow, 'down', totalItems)
    this.ensureVisible(this.uiState.currentRow, totalItems)
  }

  private ensureVisible(packageIndex: number, totalPackages: number): void {
    // Convert package index to visual index for scrolling
    const visualIndex = this.packageIndexToVisualIndex(packageIndex)
    const totalVisualItems = this.uiState.renderableItems.length || totalPackages

    // Try to show section header if the current item is just below a header
    let targetVisualIndex = visualIndex
    if (visualIndex > 0) {
      const prevItem = this.uiState.renderableItems[visualIndex - 1]
      if (prevItem?.type === 'header') {
        targetVisualIndex = visualIndex - 1
      } else if (visualIndex > 1) {
        // Also check for spacer + header combo (for first package in non-first section)
        const prevPrevItem = this.uiState.renderableItems[visualIndex - 2]
        if (prevItem?.type === 'spacer' && prevPrevItem?.type === 'header') {
          // Show spacer and header if possible
          targetVisualIndex = Math.max(0, visualIndex - 2)
        }
      }
    }

    // Scrolling up: scroll up by 1 item
    if (targetVisualIndex < this.uiState.scrollOffset) {
      this.uiState.scrollOffset = targetVisualIndex
    }
    // Scrolling down: scroll down by 1 item (smooth scrolling)
    else if (visualIndex >= this.uiState.scrollOffset + this.uiState.maxVisibleItems) {
      this.uiState.scrollOffset += 1
    }

    // Ensure scrollOffset doesn't go negative or beyond bounds
    const maxScroll = Math.max(0, totalVisualItems - this.uiState.maxVisibleItems)
    this.uiState.scrollOffset = Math.max(0, Math.min(this.uiState.scrollOffset, maxScroll))

    // Handle wrap-around: if we're at the last item and it's out of view, show it at bottom
    if (visualIndex === totalVisualItems - 1 && visualIndex >= this.uiState.scrollOffset + this.uiState.maxVisibleItems) {
      this.uiState.scrollOffset = maxScroll
    }
  }

  updateSelection(states: PackageSelectionState[], direction: 'left' | 'right'): void {
    if (states.length === 0) return

    const currentState = states[this.uiState.currentRow]
    if (!currentState) return

    if (direction === 'left') {
      // Move selection left with wraparound: latest -> range -> none -> latest
      if (currentState.selectedOption === 'latest') {
        if (currentState.hasRangeUpdate) {
          currentState.selectedOption = 'range'
        } else {
          currentState.selectedOption = 'none'
        }
      } else if (currentState.selectedOption === 'range') {
        currentState.selectedOption = 'none'
      } else if (currentState.selectedOption === 'none') {
        // Wrap around to the last available option
        if (currentState.hasMajorUpdate) {
          currentState.selectedOption = 'latest'
        } else if (currentState.hasRangeUpdate) {
          currentState.selectedOption = 'range'
        }
      }
    } else {
      // Move selection right with wraparound: none -> range -> latest -> none
      if (currentState.selectedOption === 'none') {
        if (currentState.hasRangeUpdate) {
          currentState.selectedOption = 'range'
        } else if (currentState.hasMajorUpdate) {
          currentState.selectedOption = 'latest'
        }
      } else if (currentState.selectedOption === 'range') {
        if (currentState.hasMajorUpdate) {
          currentState.selectedOption = 'latest'
        } else {
          // Wrap around to none
          currentState.selectedOption = 'none'
        }
      } else if (currentState.selectedOption === 'latest') {
        // Wrap around to none
        currentState.selectedOption = 'none'
      }
    }
  }

  bulkSelectMinor(states: PackageSelectionState[]): void {
    if (states.length === 0) return
    states.forEach((state) => {
      if (state.hasRangeUpdate) {
        state.selectedOption = 'range'
      }
    })
  }

  bulkSelectLatest(states: PackageSelectionState[]): void {
    if (states.length === 0) return
    states.forEach((state) => {
      if (state.hasMajorUpdate) {
        state.selectedOption = 'latest'
      } else if (state.hasRangeUpdate) {
        state.selectedOption = 'range'
      }
    })
  }

  bulkUnselectAll(states: PackageSelectionState[]): void {
    if (states.length === 0) return
    states.forEach((state) => {
      state.selectedOption = 'none'
    })
  }

  markRendered(renderedLines: string[]): void {
    this.uiState.renderedLines = renderedLines
    this.uiState.previousRow = this.uiState.currentRow
    this.uiState.previousScrollOffset = this.uiState.scrollOffset
  }

  setInitialRender(isInitial: boolean): void {
    this.uiState.isInitialRender = isInitial
  }

  resetForResize(): void {
    const totalItems = this.uiState.renderableItems.length || this.uiState.maxVisibleItems
    this.ensureVisible(this.uiState.currentRow, totalItems)
    this.uiState.isInitialRender = true
  }

  toggleInfoModal(): void {
    if (this.uiState.showInfoModal) {
      // Close the modal
      this.uiState.showInfoModal = false
      this.uiState.infoModalRow = -1
    } else {
      // Open the modal for the current package
      this.uiState.showInfoModal = true
      this.uiState.infoModalRow = this.uiState.currentRow
    }
    this.uiState.isInitialRender = true
  }

  closeInfoModal(): void {
    this.uiState.showInfoModal = false
    this.uiState.infoModalRow = -1
    this.uiState.isLoadingModalInfo = false
    this.uiState.isInitialRender = true
  }

  setModalLoading(isLoading: boolean): void {
    this.uiState.isLoadingModalInfo = isLoading
    this.uiState.isInitialRender = true
  }

  enterFilterMode(): void {
    this.uiState.filterMode = true
    this.uiState.filterQuery = ''
    this.uiState.isInitialRender = true
  }

  exitFilterMode(): void {
    this.uiState.filterMode = false
    this.uiState.filterQuery = ''
    this.uiState.currentRow = 0
    this.uiState.scrollOffset = 0
    this.uiState.isInitialRender = true
  }

  updateFilterQuery(query: string, filteredLength: number = 0): void {
    this.uiState.filterQuery = query
    // Reset to first item if we have results, stay at 0 if no results
    this.uiState.currentRow = filteredLength > 0 ? 0 : 0
    this.uiState.scrollOffset = 0
  }

  appendToFilterQuery(char: string): void {
    this.updateFilterQuery(this.uiState.filterQuery + char)
    this.uiState.isInitialRender = true // Force full re-render for clean display
  }

  deleteFromFilterQuery(): void {
    if (this.uiState.filterQuery.length > 0) {
      this.updateFilterQuery(this.uiState.filterQuery.slice(0, -1))
      this.uiState.isInitialRender = true // Force full re-render for clean display
    }
  }

  getFilteredStates(allStates: PackageSelectionState[]): PackageSelectionState[] {
    if (!this.uiState.filterQuery) {
      return allStates
    }
    const query = this.uiState.filterQuery.toLowerCase()
    return allStates.filter((state) => state.name.toLowerCase().includes(query))
  }
}
