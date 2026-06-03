import { PackageSelectionState, RenderableItem } from '../../types'

/** A row is navigable unless it's a display-only ignored package. */
function isNavigable(state: PackageSelectionState | undefined): boolean {
  return !!state && state.loadState !== 'ignored'
}

export interface NavigationState {
  currentRow: number // Index into states array (package index)
  previousRow: number
  scrollOffset: number // Scroll offset in visual rows (includes headers/spacers)
  previousScrollOffset: number
}

export class NavigationManager {
  private state: NavigationState
  private renderableItems: RenderableItem[] = []
  private maxVisibleItems: number

  constructor(initialRow: number = 0, maxVisibleItems: number = 19) {
    this.state = {
      currentRow: initialRow,
      previousRow: -1,
      scrollOffset: 0,
      previousScrollOffset: 0,
    }
    this.maxVisibleItems = maxVisibleItems
  }

  getState(): NavigationState {
    return { ...this.state }
  }

  getCurrentRow(): number {
    return this.state.currentRow
  }

  getScrollOffset(): number {
    return this.state.scrollOffset
  }

  setCurrentRow(row: number): void {
    this.state.previousRow = this.state.currentRow
    this.state.currentRow = row
  }

  setScrollOffset(offset: number): void {
    this.state.previousScrollOffset = this.state.scrollOffset
    this.state.scrollOffset = offset
  }

  setRenderableItems(items: RenderableItem[]): void {
    this.renderableItems = items
  }

  setMaxVisibleItems(maxVisible: number): void {
    this.maxVisibleItems = maxVisible
  }

  getMaxVisibleItems(): number {
    return this.maxVisibleItems
  }

  // Convert package index to visual row index in renderable items
  packageIndexToVisualIndex(packageIndex: number): number {
    // If no renderable items (flat mode), visual index equals package index
    if (this.renderableItems.length === 0) {
      return packageIndex
    }

    // Otherwise search in renderable items (grouped mode)
    for (let i = 0; i < this.renderableItems.length; i++) {
      const item = this.renderableItems[i]
      if (item.type === 'package' && item.originalIndex === packageIndex) {
        return i
      }
    }
    return 0
  }

  // Find the next navigable package index in the given direction, skipping
  // non-navigable (ignored) rows.
  private findNextPackageIndex(
    currentPackageIndex: number,
    direction: 'up' | 'down',
    states: PackageSelectionState[]
  ): number {
    const totalPackages = states.length

    if (this.renderableItems.length === 0) {
      // Flat mode: step in the given direction with wrap-around, skipping
      // ignored rows. Bounded by totalPackages so an all-ignored list (no
      // navigable target) leaves the cursor put instead of looping forever.
      if (totalPackages === 0) return currentPackageIndex
      const step = direction === 'up' ? -1 : 1
      let index = currentPackageIndex
      for (let i = 0; i < totalPackages; i++) {
        index = (index + step + totalPackages) % totalPackages
        if (isNavigable(states[index])) return index
      }
      return currentPackageIndex
    }

    // Grouped mode (currently unused): collect navigable package items.
    const packageItems: { visualIndex: number; packageIndex: number }[] = []
    for (let i = 0; i < this.renderableItems.length; i++) {
      const item = this.renderableItems[i]
      if (item.type === 'package' && isNavigable(item.state)) {
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

  navigateUp(states: PackageSelectionState[]): void {
    const totalItems = states.length
    if (totalItems === 0) return
    this.state.previousRow = this.state.currentRow
    this.state.currentRow = this.findNextPackageIndex(this.state.currentRow, 'up', states)
    this.ensureVisible(this.state.currentRow, totalItems)
  }

  navigateDown(states: PackageSelectionState[]): void {
    const totalItems = states.length
    if (totalItems === 0) return
    this.state.previousRow = this.state.currentRow
    this.state.currentRow = this.findNextPackageIndex(this.state.currentRow, 'down', states)
    this.ensureVisible(this.state.currentRow, totalItems)
  }

  navigateTop(states: PackageSelectionState[]): void {
    const totalItems = states.length
    if (totalItems === 0) return
    this.state.previousRow = this.state.currentRow
    this.state.currentRow = this.firstPackageIndex(states)
    this.ensureVisible(this.state.currentRow, totalItems)
  }

  navigateBottom(states: PackageSelectionState[]): void {
    const totalItems = states.length
    if (totalItems === 0) return
    this.state.previousRow = this.state.currentRow
    this.state.currentRow = this.lastPackageIndex(states)
    this.ensureVisible(this.state.currentRow, totalItems)
  }

  // Move the cursor onto the nearest navigable row if it currently sits on an
  // ignored one. Searches forward first, then backward.
  // When no navigable row exists yet (e.g. during initial load with only ignored
  // rows seeded), sets currentRow to states.length so the renderer shows no
  // highlighted row at all — it will snap into place on the next render once a
  // navigable row arrives.
  ensureCursorOnNavigable(states: PackageSelectionState[]): void {
    if (states.length === 0) return
    if (isNavigable(states[this.state.currentRow])) return
    const forward = states.findIndex(
      (state, i) => i >= this.state.currentRow && isNavigable(state)
    )
    if (forward !== -1) {
      this.state.currentRow = forward
      this.ensureVisible(this.state.currentRow, states.length)
    } else {
      const firstNavigable = states.findIndex((state) => isNavigable(state))
      if (firstNavigable !== -1) {
        this.state.currentRow = firstNavigable
        this.ensureVisible(this.state.currentRow, states.length)
      } else {
        // No navigable rows yet — park the cursor off-screen so nothing is highlighted.
        this.state.currentRow = states.length
      }
    }
  }

  private firstPackageIndex(states: PackageSelectionState[]): number {
    if (this.renderableItems.length === 0) {
      const idx = states.findIndex((state) => isNavigable(state))
      return idx === -1 ? 0 : idx
    }
    const first = this.renderableItems.find(
      (item) => item.type === 'package' && isNavigable(item.state)
    )
    return first && first.type === 'package' ? first.originalIndex : 0
  }

  private lastPackageIndex(states: PackageSelectionState[]): number {
    if (this.renderableItems.length === 0) {
      for (let i = states.length - 1; i >= 0; i--) {
        if (isNavigable(states[i])) return i
      }
      return states.length - 1
    }
    for (let i = this.renderableItems.length - 1; i >= 0; i--) {
      const item = this.renderableItems[i]
      if (item.type === 'package' && isNavigable(item.state)) return item.originalIndex
    }
    return states.length - 1
  }

  private ensureVisible(packageIndex: number, totalPackages: number): void {
    // Convert package index to visual index for scrolling
    const visualIndex = this.packageIndexToVisualIndex(packageIndex)
    const totalVisualItems = this.renderableItems.length || totalPackages

    // Try to show section header if the current item is just below a header
    let targetVisualIndex = visualIndex
    if (visualIndex > 0) {
      const prevItem = this.renderableItems[visualIndex - 1]
      if (prevItem?.type === 'header') {
        targetVisualIndex = visualIndex - 1
      } else if (visualIndex > 1) {
        // Also check for spacer + header combo (for first package in non-first section)
        const prevPrevItem = this.renderableItems[visualIndex - 2]
        if (prevItem?.type === 'spacer' && prevPrevItem?.type === 'header') {
          // Show spacer and header if possible
          targetVisualIndex = Math.max(0, visualIndex - 2)
        }
      }
    }

    // Scrolling up: scroll up by 1 item
    if (targetVisualIndex < this.state.scrollOffset) {
      this.state.scrollOffset = targetVisualIndex
    }
    // Scrolling down: adjust scroll to keep item visible
    else if (visualIndex >= this.state.scrollOffset + this.maxVisibleItems) {
      this.state.scrollOffset = visualIndex - this.maxVisibleItems + 1
    }

    // Ensure scrollOffset doesn't go negative or beyond bounds
    const maxScroll = Math.max(0, totalVisualItems - this.maxVisibleItems)
    this.state.scrollOffset = Math.max(0, Math.min(this.state.scrollOffset, maxScroll))

    // Handle wrap-around: if we're at the last item and it's out of view, show it at bottom
    if (
      visualIndex === totalVisualItems - 1 &&
      visualIndex >= this.state.scrollOffset + this.maxVisibleItems
    ) {
      this.state.scrollOffset = maxScroll
    }
  }

  resetForResize(totalItems: number): void {
    this.ensureVisible(this.state.currentRow, totalItems)
  }

  markRendered(): void {
    this.state.previousRow = this.state.currentRow
    this.state.previousScrollOffset = this.state.scrollOffset
  }
}
