import { describe, expect, it } from 'vitest'
import { NavigationManager } from '../../../../src/features/interactive/state/navigation-manager'
import type { RenderableItem } from '../../../../src/shared/types'
import { makeSelectionState } from '../../../fixtures/selection-state-factory'

// [header, pkg0, pkg1, spacer, header, pkg2] — two sections, three packages.
function makeGroupedItems(): RenderableItem[] {
  return [
    { type: 'header', title: 'Dependencies', sectionType: 'main' },
    { type: 'package', state: makeSelectionState({ name: 'pkg-0' }), originalIndex: 0 },
    { type: 'package', state: makeSelectionState({ name: 'pkg-1' }), originalIndex: 1 },
    { type: 'spacer' },
    { type: 'header', title: 'Dev Dependencies', sectionType: 'main' },
    { type: 'package', state: makeSelectionState({ name: 'pkg-2' }), originalIndex: 2 },
  ]
}

describe('NavigationManager edge paths', () => {
  it('steps up one row when no renderable items exist', () => {
    const nav = new NavigationManager(2, 5)

    nav.navigateUp(5)

    expect(nav.getCurrentRow()).toBe(1)
  })

  it('pins the wrap-around target to the bottom of a one-row viewport', () => {
    const nav = new NavigationManager(0, 1)
    nav.setRenderableItems([
      { type: 'package', state: makeSelectionState({ name: 'pkg-0' }), originalIndex: 0 },
      { type: 'header', title: 'Dev Dependencies', sectionType: 'main' },
      { type: 'package', state: makeSelectionState({ name: 'pkg-1' }), originalIndex: 1 },
    ])
    nav.setScrollOffset(2)

    nav.navigateDown(2)

    expect(nav.getCurrentRow()).toBe(1)
    expect(nav.getScrollOffset()).toBe(2)
  })
})

describe('NavigationManager (flat mode)', () => {
  it('starts at the initial row with no scroll', () => {
    const nav = new NavigationManager(2, 5)

    expect(nav.getState()).toEqual({
      currentRow: 2,
      previousRow: -1,
      scrollOffset: 0,
      previousScrollOffset: 0,
    })
    expect(nav.getMaxVisibleItems()).toBe(5)
  })

  it('tracks previous values when setting row and scroll directly', () => {
    const nav = new NavigationManager()

    nav.setCurrentRow(3)
    nav.setScrollOffset(2)

    const state = nav.getState()
    expect(state.currentRow).toBe(3)
    expect(state.previousRow).toBe(0)
    expect(state.scrollOffset).toBe(2)
    expect(state.previousScrollOffset).toBe(0)
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

  it('markRendered snapshots the current position', () => {
    const nav = new NavigationManager(0, 2)

    nav.navigateDown(5)
    nav.markRendered()

    const state = nav.getState()
    expect(state.previousRow).toBe(state.currentRow)
    expect(state.previousScrollOffset).toBe(state.scrollOffset)
  })
})

describe('NavigationManager (grouped mode)', () => {
  it('navigates only across package rows, skipping headers and spacers', () => {
    const nav = new NavigationManager(0, 10)
    nav.setRenderableItems(makeGroupedItems())

    nav.navigateDown(3)
    expect(nav.getCurrentRow()).toBe(1)

    nav.navigateDown(3)
    expect(nav.getCurrentRow()).toBe(2)

    nav.navigateDown(3)
    expect(nav.getCurrentRow()).toBe(0)
  })

  it('wraps upward to the last package', () => {
    const nav = new NavigationManager(0, 10)
    nav.setRenderableItems(makeGroupedItems())

    nav.navigateUp(3)

    expect(nav.getCurrentRow()).toBe(2)
  })

  it('jumps to the first and last package rows', () => {
    const nav = new NavigationManager(1, 10)
    nav.setRenderableItems(makeGroupedItems())

    nav.navigateBottom(3)
    expect(nav.getCurrentRow()).toBe(2)

    nav.navigateTop(3)
    expect(nav.getCurrentRow()).toBe(0)
  })

  it('maps package indices to visual rows', () => {
    const nav = new NavigationManager(0, 10)
    nav.setRenderableItems(makeGroupedItems())

    expect(nav.packageIndexToVisualIndex(0)).toBe(1)
    expect(nav.packageIndexToVisualIndex(1)).toBe(2)
    expect(nav.packageIndexToVisualIndex(2)).toBe(5)
    expect(nav.packageIndexToVisualIndex(99)).toBe(0)
  })

  it('recovers to the first package when the current row no longer exists', () => {
    const nav = new NavigationManager(42, 10)
    nav.setRenderableItems(makeGroupedItems())

    nav.navigateDown(3)

    expect(nav.getCurrentRow()).toBe(0)
  })

  it('keeps the current row when the list has no package rows', () => {
    const nav = new NavigationManager(1, 10)
    nav.setRenderableItems([
      { type: 'header', title: 'Dependencies', sectionType: 'main' },
      { type: 'spacer' },
    ])

    nav.navigateDown(3)

    expect(nav.getCurrentRow()).toBe(1)
  })

  it('reveals the section header above the first package when scrolling up', () => {
    const nav = new NavigationManager(2, 2)
    nav.setRenderableItems(makeGroupedItems())
    nav.setScrollOffset(4)

    nav.navigateUp(3) // to pkg-1 at visual row 2
    expect(nav.getScrollOffset()).toBe(2)

    nav.navigateUp(3) // to pkg-0 at visual row 1 — header at row 0 is revealed
    expect(nav.getScrollOffset()).toBe(0)
  })

  it('reveals a spacer + header pair above a section start', () => {
    const nav = new NavigationManager(1, 2)
    nav.setRenderableItems([
      { type: 'package', state: makeSelectionState({ name: 'pkg-0' }), originalIndex: 0 },
      { type: 'header', title: 'Dev Dependencies', sectionType: 'main' },
      { type: 'spacer' },
      { type: 'package', state: makeSelectionState({ name: 'pkg-1' }), originalIndex: 1 },
      { type: 'package', state: makeSelectionState({ name: 'pkg-2' }), originalIndex: 2 },
    ])
    nav.setScrollOffset(2)

    nav.setCurrentRow(1)
    nav.resetForResize(3) // ensureVisible for pkg-1 at visual row 3, header+spacer above

    expect(nav.getScrollOffset()).toBe(1)
  })

  it('scrolls to the bottom when the last package would be cut off', () => {
    const nav = new NavigationManager(0, 2)
    nav.setRenderableItems([
      { type: 'package', state: makeSelectionState({ name: 'pkg-0' }), originalIndex: 0 },
      { type: 'header', title: 'Dev Dependencies', sectionType: 'main' },
      { type: 'spacer' },
      { type: 'package', state: makeSelectionState({ name: 'pkg-1' }), originalIndex: 1 },
    ])

    nav.navigateUp(2) // wraps to pkg-1 at visual row 3

    expect(nav.getCurrentRow()).toBe(1)
    expect(nav.getScrollOffset()).toBe(2)
  })

  it('clamps the scroll to the valid range on resize', () => {
    const nav = new NavigationManager(0, 10)
    nav.setRenderableItems(makeGroupedItems())
    nav.setScrollOffset(99)

    nav.setMaxVisibleItems(10)
    nav.resetForResize(3)

    expect(nav.getScrollOffset()).toBe(0)
  })
})

describe('NavigationManager grouped fallbacks', () => {
  it('falls back to the flat last index when grouped items contain no packages', () => {
    const nav = new NavigationManager(0, 10)
    nav.setRenderableItems([
      { type: 'header', title: 'Empty Section', sectionType: 'main' },
      { type: 'spacer' },
    ])

    nav.navigateBottom(4)

    expect(nav.getCurrentRow()).toBe(3)
    nav.navigateTop(4)
    expect(nav.getCurrentRow()).toBe(0)
  })
})
