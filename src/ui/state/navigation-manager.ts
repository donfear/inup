import { RenderableItem } from '../../types'

export interface NavigationState {
  currentRow: number // Index into states array (package index)
  previousRow: number
  scrollOffset: number // Scroll offset in visual rows (includes headers/spacers)
  previousScrollOffset: number
  focusedGroupScope: string | null // When non-null, a group header is focused (by scope identity)
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
      focusedGroupScope: null,
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
    this.state.focusedGroupScope = null
  }

  setScrollOffset(offset: number): void {
    this.state.previousScrollOffset = this.state.scrollOffset
    this.state.scrollOffset = offset
  }

  setRenderableItems(items: RenderableItem[]): void {
    this.renderableItems = items
    // Clear group focus if the focused scope no longer exists as a group header
    if (this.state.focusedGroupScope !== null) {
      const stillExists = items.some(
        (item) => item.type === 'group-header' && item.scope === this.state.focusedGroupScope
      )
      if (!stillExists) {
        this.state.focusedGroupScope = null
      }
    }
  }

  clearGroupFocus(): void {
    this.state.focusedGroupScope = null
  }

  setMaxVisibleItems(maxVisible: number): void {
    this.maxVisibleItems = maxVisible
  }

  getMaxVisibleItems(): number {
    return this.maxVisibleItems
  }

  // Convert package index to visual row index in renderable items
  packageIndexToVisualIndex(packageIndex: number): number {
    if (this.renderableItems.length === 0) {
      return packageIndex
    }
    for (let i = 0; i < this.renderableItems.length; i++) {
      const item = this.renderableItems[i]
      if (item.type === 'package' && item.originalIndex === packageIndex) {
        return i
      }
    }
    return 0
  }

  getFocusedGroupScope(): string | null {
    return this.state.focusedGroupScope
  }

  getFocusedGroupVisualIndex(): number | null {
    if (this.state.focusedGroupScope === null) return null
    for (let i = 0; i < this.renderableItems.length; i++) {
      const item = this.renderableItems[i]
      if (item.type === 'group-header' && item.scope === this.state.focusedGroupScope) {
        return i
      }
    }
    return null
  }

  setFocusedGroupScope(scope: string | null): void {
    this.state.focusedGroupScope = scope
  }

  // Build ordered list of navigable focus points (packages and group headers)
  private getNavigableFocusPoints(): {
    visualIndex: number
    kind: 'package' | 'group'
    packageIndex?: number
    scope?: string
  }[] {
    const points: {
      visualIndex: number
      kind: 'package' | 'group'
      packageIndex?: number
      scope?: string
    }[] = []
    for (let i = 0; i < this.renderableItems.length; i++) {
      const item = this.renderableItems[i]
      if (item.type === 'package') {
        points.push({ visualIndex: i, kind: 'package', packageIndex: item.originalIndex })
      } else if (item.type === 'group-header') {
        points.push({ visualIndex: i, kind: 'group', scope: item.scope })
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
    if (this.state.focusedGroupScope !== null) {
      currentPos = focusPoints.findIndex(
        (p) => p.kind === 'group' && p.scope === this.state.focusedGroupScope
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
      this.state.focusedGroupScope = target.scope!
    } else {
      this.state.focusedGroupScope = null
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
    const groupVisualIndex = this.getFocusedGroupVisualIndex()
    if (groupVisualIndex !== null) {
      this.ensureVisualIndexVisible(groupVisualIndex, totalPackages)
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
    const visualIndex = this.packageIndexToVisualIndex(packageIndex)
    const totalVisualItems = this.renderableItems.length || totalPackages

    let targetVisualIndex = visualIndex
    if (visualIndex > 0) {
      const prevItem = this.renderableItems[visualIndex - 1]
      if (prevItem?.type === 'header') {
        targetVisualIndex = visualIndex - 1
      } else if (visualIndex > 1) {
        const prevPrevItem = this.renderableItems[visualIndex - 2]
        if (prevItem?.type === 'spacer' && prevPrevItem?.type === 'header') {
          targetVisualIndex = Math.max(0, visualIndex - 2)
        }
      }
    }

    if (targetVisualIndex < this.state.scrollOffset) {
      this.state.scrollOffset = targetVisualIndex
    } else if (visualIndex >= this.state.scrollOffset + this.maxVisibleItems) {
      this.state.scrollOffset = visualIndex - this.maxVisibleItems + 1
    }

    const maxScroll = Math.max(0, totalVisualItems - this.maxVisibleItems)
    this.state.scrollOffset = Math.max(0, Math.min(this.state.scrollOffset, maxScroll))

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
