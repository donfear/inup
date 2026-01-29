import { PackageSelectionState, RenderableItem } from '../../types'
import { NavigationManager, NavigationState } from './navigation-manager'
import { ModalManager, ModalState } from './modal-manager'
import { FilterManager, FilterState } from './filter-manager'
import { ThemeManager, ThemeState } from './theme-manager'

export interface DisplayState {
  maxVisibleItems: number
  terminalHeight: number
}

export interface RenderState {
  forceFullRender: boolean // Whether to force a full re-render (clear screen) instead of diff
  renderedLines: string[]
  renderableItems: RenderableItem[]
}

export interface UIState {
  currentRow: number
  previousRow: number
  scrollOffset: number
  previousScrollOffset: number
  maxVisibleItems: number
  terminalHeight: number
  forceFullRender: boolean
  renderedLines: string[]
  renderableItems: RenderableItem[]
  showInfoModal: boolean
  infoModalRow: number
  isLoadingModalInfo: boolean
  filterMode: boolean
  filterQuery: string
  showThemeModal: boolean
  currentTheme: string
}

export class StateManager {
  private navigationManager: NavigationManager
  private modalManager: ModalManager
  private filterManager: FilterManager
  private themeManager: ThemeManager
  private displayState: DisplayState
  private renderState: RenderState
  private readonly headerLines = 5 // title (with label) + empty + 1 instruction line + status + empty

  constructor(initialRow: number = 0, terminalHeight: number = 24) {
    const maxVisibleItems = Math.max(5, terminalHeight - this.headerLines - 2)

    this.navigationManager = new NavigationManager(initialRow, maxVisibleItems)
    this.modalManager = new ModalManager()
    this.filterManager = new FilterManager()
    this.themeManager = new ThemeManager()

    this.displayState = {
      maxVisibleItems,
      terminalHeight,
    }

    this.renderState = {
      forceFullRender: true,
      renderedLines: [],
      renderableItems: [],
    }
  }

  // Aggregate all state for backward compatibility
  getUIState(): UIState {
    const navState = this.navigationManager.getState()
    const modalState = this.modalManager.getState()
    const filterState = this.filterManager.getState()
    const themeState = this.themeManager.getState()

    return {
      currentRow: navState.currentRow,
      previousRow: navState.previousRow,
      scrollOffset: navState.scrollOffset,
      previousScrollOffset: navState.previousScrollOffset,
      maxVisibleItems: this.displayState.maxVisibleItems,
      terminalHeight: this.displayState.terminalHeight,
      forceFullRender: this.renderState.forceFullRender,
      renderedLines: this.renderState.renderedLines,
      renderableItems: this.renderState.renderableItems,
      showInfoModal: modalState.showInfoModal,
      infoModalRow: modalState.infoModalRow,
      isLoadingModalInfo: modalState.isLoadingModalInfo,
      filterMode: filterState.filterMode,
      filterQuery: filterState.filterQuery,
      showThemeModal: themeState.showThemeModal,
      currentTheme: themeState.currentTheme,
    }
  }

  setRenderableItems(items: RenderableItem[]): void {
    this.renderState.renderableItems = items
    this.navigationManager.setRenderableItems(items)
  }

  // Navigation delegation
  navigateUp(totalItems: number): void {
    this.navigationManager.navigateUp(totalItems)
  }

  navigateDown(totalItems: number): void {
    this.navigationManager.navigateDown(totalItems)
  }

  packageIndexToVisualIndex(packageIndex: number): number {
    return this.navigationManager.packageIndexToVisualIndex(packageIndex)
  }

  // Selection logic (still in StateManager as it operates on external state)
  updateSelection(states: PackageSelectionState[], direction: 'left' | 'right'): void {
    if (states.length === 0) return

    const currentRow = this.navigationManager.getCurrentRow()
    const currentState = states[currentRow]
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

  // Modal delegation
  toggleInfoModal(): void {
    const currentRow = this.navigationManager.getCurrentRow()
    this.modalManager.toggleInfoModal(currentRow)
    this.renderState.forceFullRender = true
  }

  closeInfoModal(): void {
    this.modalManager.closeInfoModal()
    this.renderState.forceFullRender = true
  }

  setModalLoading(isLoading: boolean): void {
    this.modalManager.setModalLoading(isLoading)
    this.renderState.forceFullRender = true
  }

  // Filter delegation
  enterFilterMode(): void {
    this.filterManager.enterFilterMode()
    // Use incremental render for search mode toggle (no blink)
  }

  exitFilterMode(): void {
    this.filterManager.exitFilterMode()
    this.navigationManager.setCurrentRow(0)
    this.navigationManager.setScrollOffset(0)
    // Use incremental render for search mode toggle (no blink)
  }

  updateFilterQuery(query: string): void {
    this.filterManager.updateFilterQuery(query)
    this.navigationManager.setCurrentRow(0)
    this.navigationManager.setScrollOffset(0)
  }

  appendToFilterQuery(char: string): void {
    this.filterManager.appendToFilterQuery(char)
    this.navigationManager.setCurrentRow(0)
    this.navigationManager.setScrollOffset(0)
  }

  deleteFromFilterQuery(): void {
    this.filterManager.deleteFromFilterQuery()
    this.navigationManager.setCurrentRow(0)
    this.navigationManager.setScrollOffset(0)
  }

  getFilteredStates(allStates: PackageSelectionState[]): PackageSelectionState[] {
    return this.filterManager.getFilteredStates(allStates)
  }

  toggleDependencyTypeFilter(type: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'): void {
    this.filterManager.toggleDependencyType(type)
    // Reset navigation when filter changes
    this.navigationManager.setCurrentRow(0)
    this.navigationManager.setScrollOffset(0)
  }

  getActiveFilterLabel(): string {
    return this.filterManager.getActiveFilterLabel()
  }

  // Display and render state management
  updateTerminalHeight(newHeight: number): boolean {
    const newMaxVisibleItems = Math.max(5, newHeight - this.headerLines - 2)

    if (
      newHeight !== this.displayState.terminalHeight ||
      newMaxVisibleItems !== this.displayState.maxVisibleItems
    ) {
      this.displayState.terminalHeight = newHeight
      this.displayState.maxVisibleItems = newMaxVisibleItems
      this.navigationManager.setMaxVisibleItems(newMaxVisibleItems)
      return true // Changed
    }
    return false // No change
  }

  markRendered(renderedLines: string[]): void {
    this.renderState.renderedLines = renderedLines
    this.navigationManager.markRendered()
  }

  setInitialRender(isInitial: boolean): void {
    this.renderState.forceFullRender = isInitial
  }

  resetForResize(): void {
    const totalItems = this.renderState.renderableItems.length || this.displayState.maxVisibleItems
    this.navigationManager.resetForResize(totalItems)
    this.renderState.forceFullRender = true
  }

  // Theme delegation
  toggleThemeModal(): void {
    this.themeManager.toggleThemeModal()
    this.renderState.forceFullRender = true
  }

  closeThemeModal(): void {
    this.themeManager.closeThemeModal()
    this.renderState.forceFullRender = true
  }

  previewTheme(themeName: string): void {
    this.themeManager.previewTheme(themeName)
    this.renderState.forceFullRender = true
  }

  confirmTheme(): void {
    this.themeManager.confirmTheme()
    this.renderState.forceFullRender = true
  }

  getThemeManager(): ThemeManager {
    return this.themeManager
  }
}
