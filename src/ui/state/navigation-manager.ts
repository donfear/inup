import { RenderableItem } from '../../types'

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
  private readonly headerLines = 5 // title (with label) + empty + 1 instruction line + status + empty

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

  // Find the next navigable package index in the given direction
  private findNextPackageIndex(
    currentPackageIndex: number,
    direction: 'up' | 'down',
    totalPackages: number
  ): number {
    if (this.renderableItems.length === 0) {
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
    for (let i = 0; i < this.renderableItems.length; i++) {
      const item = this.renderableItems[i]
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

  navigateUp(totalItems: number): void {
    if (totalItems === 0) return
    this.state.previousRow = this.state.currentRow
    this.state.currentRow = this.findNextPackageIndex(this.state.currentRow, 'up', totalItems)
    this.ensureVisible(this.state.currentRow, totalItems)
  }

  navigateDown(totalItems: number): void {
    if (totalItems === 0) return
    this.state.previousRow = this.state.currentRow
    this.state.currentRow = this.findNextPackageIndex(this.state.currentRow, 'down', totalItems)
    this.ensureVisible(this.state.currentRow, totalItems)
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
    // Scrolling down: scroll down by 1 item (smooth scrolling)
    else if (visualIndex >= this.state.scrollOffset + this.maxVisibleItems) {
      this.state.scrollOffset += 1
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
