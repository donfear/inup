import { PackageSelectionState, RenderableItem, VulnerabilityDisplayOptions } from '../../types'
import { NavigationManager } from './navigation-manager'
import { ModalManager, InfoModalTab } from './modal-manager'
import { FilterManager } from './filter-manager'
import { ThemeManager } from './theme-manager'
import { buildScopeGroupedItems } from './scope-grouping'

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
  infoModalScrollOffset: number
  infoModalTab: InfoModalTab
  showDebugModal: boolean
  debugModalScrollOffset: number
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
  private collapsedScopes: Set<string> = new Set()
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
      infoModalScrollOffset: modalState.infoModalScrollOffset,
      infoModalTab: modalState.infoModalTab,
      showDebugModal: modalState.showDebugModal,
      debugModalScrollOffset: modalState.debugModalScrollOffset,
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

  buildAndSetRenderableItems(filteredStates: PackageSelectionState[]): RenderableItem[] {
    const items = buildScopeGroupedItems(filteredStates, {
      collapsedScopes: this.collapsedScopes,
    })
    this.setRenderableItems(items)
    return items
  }

  getFocusedGroupVisualIndex(): number | null {
    return this.navigationManager.getFocusedGroupVisualIndex()
  }

  getFocusedGroupScope(): string | null {
    return this.navigationManager.getFocusedGroupScope()
  }

  getFocusedGroupHeader(): { scope: string; memberIndices: number[]; collapsed: boolean } | null {
    const scope = this.navigationManager.getFocusedGroupScope()
    if (scope === null) return null
    for (const item of this.renderState.renderableItems) {
      if (item.type === 'group-header' && item.scope === scope) {
        return { scope: item.scope, memberIndices: item.memberIndices, collapsed: item.collapsed }
      }
    }
    return null
  }

  isScopeCollapsed(scope: string): boolean {
    return this.collapsedScopes.has(scope)
  }

  toggleFocusedGroupCollapse(): boolean {
    const scope = this.navigationManager.getFocusedGroupScope()
    if (scope === null) return false
    if (this.collapsedScopes.has(scope)) {
      this.collapsedScopes.delete(scope)
    } else {
      this.collapsedScopes.add(scope)
    }
    this.renderState.forceFullRender = true
    return true
  }

  applyGroupSelection(
    filteredStates: PackageSelectionState[],
    option: 'none' | 'range' | 'latest'
  ): void {
    const group = this.getFocusedGroupHeader()
    if (!group) return
    group.memberIndices.forEach((idx) => {
      const state = filteredStates[idx]
      if (!state || state.loadState !== 'ready') return
      if (option === 'range' && !state.hasRangeUpdate) return
      if (option === 'latest' && !state.hasMajorUpdate) return
      state.selectedOption = option
    })
  }

  cycleGroupSelection(filteredStates: PackageSelectionState[], direction: 'left' | 'right'): void {
    const group = this.getFocusedGroupHeader()
    if (!group) return

    const members = group.memberIndices
      .map((i) => filteredStates[i])
      .filter((s): s is PackageSelectionState => !!s && s.loadState === 'ready')
    if (members.length === 0) return

    const hasRange = members.some((m) => m.hasRangeUpdate)
    const hasMajor = members.some((m) => m.hasMajorUpdate)

    // Dominant = most common current selection among loaded members.
    // Tie-break order: latest > range > none (so a half-and-half group between
    // 'latest' and 'none' moves out of 'latest' on Left and into 'none' on Right).
    const counts = { none: 0, range: 0, latest: 0 }
    members.forEach((m) => counts[m.selectedOption]++)
    const dominant: 'none' | 'range' | 'latest' =
      counts.latest >= counts.range && counts.latest >= counts.none && counts.latest > 0
        ? 'latest'
        : counts.range >= counts.none && counts.range > 0
          ? 'range'
          : 'none'

    let next: 'none' | 'range' | 'latest' = dominant
    if (direction === 'right') {
      if (dominant === 'none') next = hasRange ? 'range' : hasMajor ? 'latest' : 'none'
      else if (dominant === 'range') next = hasMajor ? 'latest' : 'none'
      else next = 'none'
    } else {
      if (dominant === 'latest') next = hasRange ? 'range' : 'none'
      else if (dominant === 'range') next = 'none'
      else next = hasMajor ? 'latest' : hasRange ? 'range' : 'none'
    }

    this.applyGroupSelection(filteredStates, next)
  }

  // Aggregate selection summary for a group header — used by the renderer.
  getGroupAggregate(
    filteredStates: PackageSelectionState[],
    memberIndices: number[]
  ): {
    total: number
    ready: number
    pending: number
    selectedNone: number
    selectedRange: number
    selectedLatest: number
    hasRangeAvailable: number
    hasMajorAvailable: number
    vulnerable: number
  } {
    const agg = {
      total: memberIndices.length,
      ready: 0,
      pending: 0,
      selectedNone: 0,
      selectedRange: 0,
      selectedLatest: 0,
      hasRangeAvailable: 0,
      hasMajorAvailable: 0,
      vulnerable: 0,
    }
    memberIndices.forEach((i) => {
      const s = filteredStates[i]
      if (!s) return
      if (s.loadState === 'ready') agg.ready++
      if (s.loadState === 'pending') agg.pending++
      if (s.hasRangeUpdate) agg.hasRangeAvailable++
      if (s.hasMajorUpdate) agg.hasMajorAvailable++
      if (s.vulnerability && s.vulnerability.count > 0) agg.vulnerable++
      if (s.selectedOption === 'none') agg.selectedNone++
      else if (s.selectedOption === 'range') agg.selectedRange++
      else if (s.selectedOption === 'latest') agg.selectedLatest++
    })
    return agg
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
    if (!currentState || currentState.loadState !== 'ready') return

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
      if (state.loadState === 'ready' && state.hasRangeUpdate) {
        state.selectedOption = 'range'
      }
    })
  }

  bulkSelectLatest(states: PackageSelectionState[]): void {
    if (states.length === 0) return
    states.forEach((state) => {
      if (state.loadState === 'ready' && state.hasMajorUpdate) {
        state.selectedOption = 'latest'
      } else if (state.loadState === 'ready' && state.hasRangeUpdate) {
        state.selectedOption = 'range'
      }
    })
  }

  bulkUnselectAll(states: PackageSelectionState[]): void {
    if (states.length === 0) return
    states.forEach((state) => {
      if (state.loadState === 'ready') {
        state.selectedOption = 'none'
      }
    })
  }

  // Modal delegation
  toggleInfoModal(): number {
    const currentRow = this.navigationManager.getCurrentRow()
    const sessionId = this.modalManager.toggleInfoModal(currentRow)
    this.renderState.forceFullRender = true
    return sessionId
  }

  closeInfoModal(): void {
    this.modalManager.closeInfoModal()
    this.renderState.forceFullRender = true
  }

  setModalLoading(isLoading: boolean, sessionId?: number): boolean {
    const updated = this.modalManager.setModalLoading(isLoading, sessionId)
    if (updated) {
      this.renderState.forceFullRender = true
    }
    return updated
  }

  getInfoModalSessionId(): number {
    return this.modalManager.getSessionId()
  }

  resetInfoModalScroll(): void {
    this.modalManager.resetScroll()
  }

  scrollInfoModalUp(): boolean {
    return this.modalManager.scrollModalUp()
    // Don't force full render — modal viewport handles its own overwrite
  }

  scrollInfoModalDown(maxOffset: number): boolean {
    return this.modalManager.scrollModalDown(maxOffset)
    // Don't force full render — modal viewport handles its own overwrite
  }

  getInfoModalScrollOffset(): number {
    return this.modalManager.getScrollOffset()
  }

  clampInfoModalScrollOffset(maxOffset: number): boolean {
    return this.modalManager.clampScrollOffset(maxOffset)
  }

  setInfoModalTab(tab: InfoModalTab): boolean {
    const changed = this.modalManager.setInfoModalTab(tab)
    if (changed) {
      this.renderState.forceFullRender = true
    }
    return changed
  }

  getInfoModalTab(): InfoModalTab {
    return this.modalManager.getInfoModalTab()
  }

  toggleDebugModal(): void {
    this.modalManager.toggleDebugModal()
  }

  closeDebugModal(): void {
    this.modalManager.closeDebugModal()
  }

  scrollDebugModalUp(): boolean {
    return this.modalManager.scrollDebugModalUp()
  }

  scrollDebugModalDown(maxOffset: number): boolean {
    return this.modalManager.scrollDebugModalDown(maxOffset)
  }

  clampDebugModalScrollOffset(maxOffset: number): boolean {
    return this.modalManager.clampDebugModalScrollOffset(maxOffset)
  }

  // Filter delegation
  enterFilterMode(preserveQuery: boolean = false): void {
    this.filterManager.enterFilterMode(preserveQuery)
    // Use incremental render for search mode toggle (no blink)
  }

  exitFilterMode(clearQuery: boolean = false): void {
    this.filterManager.exitFilterMode(clearQuery)
    if (clearQuery) {
      this.navigationManager.setCurrentRow(0)
      this.navigationManager.setScrollOffset(0)
    }
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

  getFilteredStates(
    allStates: PackageSelectionState[],
    options?: VulnerabilityDisplayOptions
  ): PackageSelectionState[] {
    return this.filterManager.getFilteredStates(allStates, options)
  }

  toggleDependencyTypeFilter(
    type: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'
  ): void {
    this.filterManager.toggleDependencyType(type)
    // Reset navigation when filter changes
    this.navigationManager.setCurrentRow(0)
    this.navigationManager.setScrollOffset(0)
    // Use incremental render (no blink)
  }

  toggleVulnerableFilter(): void {
    this.filterManager.toggleVulnerableFilter()
    this.navigationManager.setCurrentRow(0)
    this.navigationManager.setScrollOffset(0)
  }

  isVulnerableFilterActive(): boolean {
    return this.filterManager.isVulnerableFilterActive()
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

  resetForResize(totalFilteredItems?: number): void {
    const totalItems =
      totalFilteredItems ||
      this.renderState.renderableItems.length ||
      this.displayState.maxVisibleItems
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
