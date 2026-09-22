import { describe, expect, it } from 'vitest'
import { NavigationManager } from '../../../../src/features/interactive/state/navigation-manager'

describe('NavigationManager edge paths', () => {
  it('steps up one row', () => {
    const nav = new NavigationManager(2, 5)

    nav.navigateUp(5)

    expect(nav.getCurrentRow()).toBe(1)
  })
})

describe('NavigationManager', () => {
  it('starts at the initial row with no scroll', () => {
    const nav = new NavigationManager(2, 5)

    expect(nav.getState()).toEqual({ currentRow: 2, scrollOffset: 0 })
    expect(nav.getMaxVisibleItems()).toBe(5)
  })

  it('sets row and scroll directly', () => {
    const nav = new NavigationManager()

    nav.setCurrentRow(3)
    nav.setScrollOffset(2)

    expect(nav.getState()).toEqual({ currentRow: 3, scrollOffset: 2 })
  })

  it('wraps from the first row to the last when navigating up', () => {
    const nav = new NavigationManager(0, 10)

    nav.navigateUp(3)

    expect(nav.getCurrentRow()).toBe(2)
  })

  it('wraps from the last row to the first when navigating down', () => {
    const nav = new NavigationManager(2, 10)

    nav.navigateDown(3)

    expect(nav.getCurrentRow()).toBe(0)
  })

  it('ignores navigation when there are no items', () => {
    const nav = new NavigationManager(0, 10)

    nav.navigateDown(0)
    nav.navigateUp(0)
    nav.navigateTop(0)
    nav.navigateBottom(0)

    expect(nav.getCurrentRow()).toBe(0)
  })

  it('jumps to top and bottom', () => {
    const nav = new NavigationManager(2, 10)

    nav.navigateBottom(5)
    expect(nav.getCurrentRow()).toBe(4)

    nav.navigateTop(5)
    expect(nav.getCurrentRow()).toBe(0)
  })

  it('scrolls down one row at a time to keep the cursor visible', () => {
    const nav = new NavigationManager(0, 2)

    nav.navigateDown(5) // row 1, still visible
    expect(nav.getScrollOffset()).toBe(0)

    nav.navigateDown(5) // row 2, scrolls to 1
    expect(nav.getScrollOffset()).toBe(1)

    nav.navigateDown(5) // row 3
    nav.navigateDown(5) // row 4
    expect(nav.getScrollOffset()).toBe(3)
  })

  it('resets the scroll when wrapping back to the top', () => {
    const nav = new NavigationManager(4, 2)
    nav.setScrollOffset(3)

    nav.navigateDown(5)

    expect(nav.getCurrentRow()).toBe(0)
    expect(nav.getScrollOffset()).toBe(0)
  })

  it('scrolls to the bottom when wrapping up from the first row', () => {
    const nav = new NavigationManager(0, 2)

    nav.navigateUp(5)

    expect(nav.getCurrentRow()).toBe(4)
    expect(nav.getScrollOffset()).toBe(3)
  })
})

describe('NavigationManager resize', () => {
  it('clamps the scroll to the valid range on resize', () => {
    const nav = new NavigationManager(0, 10)
    nav.setScrollOffset(99)

    nav.setMaxVisibleItems(10)
    nav.resetForResize(3)

    expect(nav.getScrollOffset()).toBe(0)
  })
})

describe('NavigationManager page navigation', () => {
  it('moves by a page and keeps the destination visible', () => {
    const nav = new NavigationManager(0, 2)
    nav.navigatePageDown(5)
    expect(nav.getCurrentRow()).toBe(2)
    expect(nav.getScrollOffset()).toBe(1)
    nav.navigatePageUp(5)
    expect(nav.getCurrentRow()).toBe(0)
    expect(nav.getScrollOffset()).toBe(0)
  })

  it('clamps both ends without wrapping, even when a page is larger than the list', () => {
    const nav = new NavigationManager(0, 10)
    nav.navigatePageUp(5)
    expect(nav.getCurrentRow()).toBe(0)
    nav.navigatePageDown(5)
    expect(nav.getCurrentRow()).toBe(4)
    nav.navigatePageDown(5)
    expect(nav.getCurrentRow()).toBe(4)
    nav.navigatePageUp(5)
    expect(nav.getCurrentRow()).toBe(0)
  })

  it('does nothing for an empty list', () => {
    const nav = new NavigationManager(0, 2)
    nav.navigatePageUp(0)
    nav.navigatePageDown(0)
    expect(nav.getCurrentRow()).toBe(0)
  })

  it('stops immediately when there is only one package', () => {
    const nav = new NavigationManager(0, 2)
    nav.navigatePageDown(1)
    expect(nav.getCurrentRow()).toBe(0)
  })
})
