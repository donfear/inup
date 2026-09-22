export interface NavigationState {
  currentRow: number // Index into states array (package index)
  scrollOffset: number // Scroll offset in rows
}

export class NavigationManager {
  private state: NavigationState
  private maxVisibleItems: number

  constructor(initialRow: number = 0, maxVisibleItems: number = 19) {
    this.state = {
      currentRow: initialRow,
      scrollOffset: 0,
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
    this.state.currentRow = row
  }

  setScrollOffset(offset: number): void {
    this.state.scrollOffset = offset
  }

  setMaxVisibleItems(maxVisible: number): void {
    this.maxVisibleItems = maxVisible
  }

  getMaxVisibleItems(): number {
    return this.maxVisibleItems
  }

  navigateUp(totalItems: number): void {
    if (totalItems === 0) return
    const row = this.state.currentRow
    // Wrap around at the top
    this.state.currentRow = row <= 0 ? totalItems - 1 : row - 1
    this.ensureVisible(this.state.currentRow, totalItems)
  }

  navigateDown(totalItems: number): void {
    if (totalItems === 0) return
    const row = this.state.currentRow
    // Wrap around at the bottom
    this.state.currentRow = row >= totalItems - 1 ? 0 : row + 1
    this.ensureVisible(this.state.currentRow, totalItems)
  }

  navigateTop(totalItems: number): void {
    if (totalItems === 0) return
    this.state.currentRow = 0
    this.ensureVisible(this.state.currentRow, totalItems)
  }

  navigateBottom(totalItems: number): void {
    if (totalItems === 0) return
    this.state.currentRow = totalItems - 1
    this.ensureVisible(this.state.currentRow, totalItems)
  }

  navigatePageUp(totalItems: number): void {
    this.navigatePage(-this.maxVisibleItems, totalItems)
  }

  navigatePageDown(totalItems: number): void {
    this.navigatePage(this.maxVisibleItems, totalItems)
  }

  private navigatePage(delta: number, totalItems: number): void {
    if (totalItems === 0) return
    this.state.currentRow = Math.max(0, Math.min(totalItems - 1, this.state.currentRow + delta))
    this.ensureVisible(this.state.currentRow, totalItems)
  }

  private ensureVisible(row: number, totalItems: number): void {
    // Scrolling up: scroll up by 1 item
    if (row < this.state.scrollOffset) {
      this.state.scrollOffset = row
    }
    // Scrolling down: adjust scroll to keep item visible
    else if (row >= this.state.scrollOffset + this.maxVisibleItems) {
      this.state.scrollOffset = row - this.maxVisibleItems + 1
    }

    // Ensure scrollOffset doesn't go negative or beyond bounds
    const maxScroll = Math.max(0, totalItems - this.maxVisibleItems)
    this.state.scrollOffset = Math.max(0, Math.min(this.state.scrollOffset, maxScroll))
  }

  resetForResize(totalItems: number): void {
    this.ensureVisible(this.state.currentRow, totalItems)
  }
}
