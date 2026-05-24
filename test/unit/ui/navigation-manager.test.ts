import { describe, expect, it } from 'vitest'
import { NavigationManager } from '../../../src/ui/state/navigation-manager'
import { PackageSelectionState, RenderableItem } from '../../../src/types'
import { buildScopeGroupedItems } from '../../../src/ui/state/scope-grouping'

const make = (name: string): PackageSelectionState => ({
  name,
  packageJsonPath: '/repo/package.json',
  packageJsonPaths: ['/repo/package.json'],
  currentVersionSpecifier: '^1.0.0',
  currentVersion: '1.0.0',
  rangeVersion: '1.0.0',
  latestVersion: '1.0.0',
  selectedOption: 'none',
  loadState: 'ready',
  hasRangeUpdate: false,
  hasMajorUpdate: false,
  type: 'dependencies',
})

describe('NavigationManager group focus', () => {
  it('moves focus onto a group header when navigating into a group', () => {
    const states = [make('react'), make('@tiptap/react'), make('@tiptap/pm')]
    const items = buildScopeGroupedItems(states)
    const nav = new NavigationManager(0, 10)
    nav.setRenderableItems(items)

    // Start at react (currentRow=0). navigateDown should reach @tiptap header next.
    nav.navigateDown(states.length)
    expect(nav.getFocusedGroupScope()).toBe('@tiptap')

    // Next down: into first @tiptap member (index 1 in states).
    nav.navigateDown(states.length)
    expect(nav.getFocusedGroupScope()).toBeNull()
    expect(nav.getCurrentRow()).toBe(1)
  })

  it('keeps a focused group focused after rebuild if the scope still exists as a group', () => {
    const states = [make('@tiptap/react'), make('@tiptap/pm'), make('@tiptap/extension-link')]
    const itemsA = buildScopeGroupedItems(states)
    const nav = new NavigationManager(0, 10)
    nav.setRenderableItems(itemsA)

    // Move focus onto @tiptap header
    nav.navigateUp(states.length) // wrap; the only navigable points are header + 3 packages, so up from idx 0 -> last package
    // Re-navigate deterministically: down brings us to header (from package), down to first, etc.
    nav.setRenderableItems(itemsA)
    // Simulate the user landing on the header by directly setting it
    nav.setFocusedGroupScope('@tiptap')
    expect(nav.getFocusedGroupScope()).toBe('@tiptap')

    // Rebuild with the same items (e.g. filter that doesn't remove the group)
    const itemsB = buildScopeGroupedItems(states)
    nav.setRenderableItems(itemsB)
    expect(nav.getFocusedGroupScope()).toBe('@tiptap')
  })

  it('clears focus if rebuild removes the focused scope', () => {
    const states = [make('@tiptap/react'), make('@tiptap/pm')]
    const items = buildScopeGroupedItems(states)
    const nav = new NavigationManager(0, 10)
    nav.setRenderableItems(items)
    nav.setFocusedGroupScope('@tiptap')

    // After rebuild with the group filtered out, focus should clear.
    const emptyItems: RenderableItem[] = []
    nav.setRenderableItems(emptyItems)
    expect(nav.getFocusedGroupScope()).toBeNull()
  })

  it('packageIndexToVisualIndex finds the package row inside a group', () => {
    const states = [make('react'), make('@tiptap/react'), make('@tiptap/pm')]
    const items = buildScopeGroupedItems(states)
    const nav = new NavigationManager(0, 10)
    nav.setRenderableItems(items)

    // react is at visual index 0
    expect(nav.packageIndexToVisualIndex(0)).toBe(0)
    // @tiptap/react is at visual index 2 (after header at 1)
    expect(nav.packageIndexToVisualIndex(1)).toBe(2)
    // @tiptap/pm is at visual index 3
    expect(nav.packageIndexToVisualIndex(2)).toBe(3)
  })

  it('falls back to flat navigation when there are no renderable items', () => {
    const nav = new NavigationManager(0, 10)
    nav.navigateDown(3)
    expect(nav.getCurrentRow()).toBe(1)
    nav.navigateDown(3)
    nav.navigateDown(3)
    // Wraps at the end
    expect(nav.getCurrentRow()).toBe(0)
  })
})
