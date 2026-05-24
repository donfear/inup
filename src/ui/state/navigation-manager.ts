import { RenderableItem } from '../../types'

export interface NavigationState {
  currentRow: number // Index into states array (package index)
  previousRow: number
  scrollOffset: number // Scroll offset in visual rows (includes headers/spacers)
  previousScrollOffset: number
  focusedGroupVisualIndex: number | null // When non-null, a group header is focused
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
      focusedGroupVisualIndex: null,
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
    this.state.focusedGroupVisualIndex = null
  }

  setScrollOffset(offset: number): void {
    this.state.previousScrollOffset = this.state.scrollOffset
    this.state.scrollOffset = offset
  }

  setRenderableItems(items: RenderableItem[]): void {
    this.renderableItems = items
    // Clear group focus if it no longer points at a valid group header
    if (this.state.focusedGroupVisualIndex !== null) {
      const idx = this.state.focusedGroupVisualIndex
      if (idx >= items.length || items[idx]?.type !== 'group-header') {
        this.state.focusedGroupVisualIndex = null
      }
    }
  }

  clearGroupFocus(): void {
    this.state.focusedGroupVisualIndex = null
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

  getFocusedGroupVisualIndex(): number | null {
    return this.state.focusedGroupVisualIndex
  }

  // Build ordered list of navigable focus points (packages and group headers)
  private getNavigableFocusPoints(): {
    visualIndex: number
    kind: 'package' | 'group'
    packageIndex?: number
  }[] {
    const points: { visualIndex: number; kind: 'package' | 'group'; packageIndex?: number }[] = []
    for (let i = 0; i < this.renderableItems.length; i++) {
      const item = this.renderableItems[i]
      if (item.type === 'package') {
        points.push({ visualIndex: i, kind: 'package', packageIndex: item.originalIndex })
      } else if (item.type === 'group-header') {
        points.push({ visualIndex: i, kind: 'group' })
      }
    }
    return points
  }

  // Find the next navigable focus in the given direction
  private moveFocus(direction: 'up' | 'down', totalPackages: number): void {
    if (this.renderableItems.length === 0) {
      if (direction === 'up') {
        this.state.currentRow =
          this.state.currentRow <= 0 ? totalPackages - 1 : this.state.currentRow - 1
      } else {
        this.state.currentRow =
          this.state.currentRow >= totalPackages - 1 ? 0 : this.state.currentRow + 1
      }
      return
    }

    const focusPoints = this.getNavigableFocusPoints()
    if (focusPoints.length === 0) return

    let currentPos = -1
    if (this.state.focusedGroupVisualIndex !== null) {
      currentPos = focusPoints.findIndex(
        (p) => p.kind === 'group' && p.visualIndex === this.state.focusedGroupVisualIndex
      )
    } else {
      currentPos = focusPoints.findIndex(
        (p) => p.kind === 'package' && p.packageIndex === this.state.currentRow
      )
    }
    if (currentPos === -1) currentPos = 0

    const newPos =
      direction === 'up'
        ? currentPos <= 0
          ? focusPoints.length - 1
          : currentPos - 1
        : currentPos >= focusPoints.length - 1
          ? 0
          : currentPos + 1

    const target = focusPoints[newPos]
    if (target.kind === 'group') {
      this.state.focusedGroupVisualIndex = target.visualIndex
    } else {
      this.state.focusedGroupVisualIndex = null
      this.state.currentRow = target.packageIndex!
    }
  }

  navigateUp(totalItems: number): void {
    if (totalItems === 0) return
    this.state.previousRow = this.state.currentRow
    this.moveFocus('up', totalItems)
    this.ensureFocusVisible(totalItems)
  }

  navigateDown(totalItems: number): void {
    if (totalItems === 0) return
    this.state.previousRow = this.state.currentRow
    this.moveFocus('down', totalItems)
    this.ensureFocusVisible(totalItems)
  }

  private ensureFocusVisible(totalPackages: number): void {
    if (this.state.focusedGroupVisualIndex !== null) {
      this.ensureVisualIndexVisible(this.state.focusedGroupVisualIndex, totalPackages)
    } else {
      this.ensureVisible(this.state.currentRow, totalPackages)
    }
  }

  private ensureVisualIndexVisible(visualIndex: number, totalPackages: number): void {
    const totalVisualItems = this.renderableItems.length || totalPackages
    if (visualIndex < this.state.scrollOffset) {
      this.state.scrollOffset = visualIndex
    } else if (visualIndex >= this.state.scrollOffset + this.maxVisibleItems) {
      this.state.scrollOffset = visualIndex - this.maxVisibleItems + 1
    }
    const maxScroll = Math.max(0, totalVisualItems - this.maxVisibleItems)
    this.state.scrollOffset = Math.max(0, Math.min(this.state.scrollOffset, maxScroll))
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
