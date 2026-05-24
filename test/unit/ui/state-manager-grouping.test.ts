import { describe, expect, it } from 'vitest'
import { StateManager } from '../../../src/ui/state'
import { PackageSelectionState } from '../../../src/types'

const make = (overrides: Partial<PackageSelectionState>): PackageSelectionState => ({
  name: 'pkg',
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
  ...overrides,
})

describe('StateManager group operations', () => {
  it('toggleFocusedGroupCollapse returns false when no group is focused', () => {
    const sm = new StateManager(0, 30)
    const states = [make({ name: 'react' })]
    sm.buildAndSetRenderableItems(states)
    expect(sm.toggleFocusedGroupCollapse()).toBe(false)
  })

  it('toggleFocusedGroupCollapse toggles collapsed state for the focused scope', () => {
    const sm = new StateManager(0, 30)
    const states = [
      make({ name: '@tiptap/react' }),
      make({ name: '@tiptap/pm' }),
    ]
    sm.buildAndSetRenderableItems(states)

    // Focus the @tiptap group directly
    ;(sm as any).navigationManager.setFocusedGroupScope('@tiptap')

    expect(sm.isScopeCollapsed('@tiptap')).toBe(false)
    expect(sm.toggleFocusedGroupCollapse()).toBe(true)
    expect(sm.isScopeCollapsed('@tiptap')).toBe(true)

    // After rebuild, the collapsed state persists and the group still has a header.
    const items = sm.buildAndSetRenderableItems(states)
    const header = items.find((i) => i.type === 'group-header')
    expect(header).toBeDefined()
    if (header && header.type === 'group-header') {
      expect(header.collapsed).toBe(true)
    }
    // Only the header should remain (no member rows when collapsed).
    expect(items.filter((i) => i.type === 'package')).toHaveLength(0)

    // Toggle back to expanded
    expect(sm.toggleFocusedGroupCollapse()).toBe(true)
    expect(sm.isScopeCollapsed('@tiptap')).toBe(false)
  })

  it('cycleGroupSelection right moves none -> range when any member has a range update', () => {
    const sm = new StateManager(0, 30)
    const states = [
      make({
        name: '@tiptap/react',
        hasRangeUpdate: true,
        rangeVersion: '3.23.6',
        currentVersionSpecifier: '^3.23.4',
      }),
      make({
        name: '@tiptap/pm',
        hasRangeUpdate: true,
        rangeVersion: '3.23.6',
        currentVersionSpecifier: '^3.23.4',
      }),
    ]
    sm.buildAndSetRenderableItems(states)
    ;(sm as any).navigationManager.setFocusedGroupScope('@tiptap')

    sm.cycleGroupSelection(states, 'right')
    expect(states[0].selectedOption).toBe('range')
    expect(states[1].selectedOption).toBe('range')
  })

  it('cycleGroupSelection only applies range to members that actually have a range update', () => {
    const sm = new StateManager(0, 30)
    const states = [
      make({ name: '@scope/a', hasRangeUpdate: true }),
      make({ name: '@scope/b', hasRangeUpdate: false }),
    ]
    sm.buildAndSetRenderableItems(states)
    ;(sm as any).navigationManager.setFocusedGroupScope('@scope')

    sm.cycleGroupSelection(states, 'right')
    expect(states[0].selectedOption).toBe('range')
    expect(states[1].selectedOption).toBe('none') // skipped — no range available
  })

  it('cycleGroupSelection skips members that are still loading', () => {
    const sm = new StateManager(0, 30)
    const states = [
      make({ name: '@scope/a', hasRangeUpdate: true }),
      make({ name: '@scope/b', loadState: 'pending' }),
    ]
    sm.buildAndSetRenderableItems(states)
    ;(sm as any).navigationManager.setFocusedGroupScope('@scope')

    sm.cycleGroupSelection(states, 'right')
    expect(states[0].selectedOption).toBe('range')
    expect(states[1].selectedOption).toBe('none')
  })

  it('getGroupAggregate counts selected, available, pending, and vulnerable members', () => {
    const sm = new StateManager(0, 30)
    const states = [
      make({ name: '@scope/a', selectedOption: 'range', hasRangeUpdate: true }),
      make({ name: '@scope/b', selectedOption: 'latest', hasMajorUpdate: true, hasRangeUpdate: true }),
      make({ name: '@scope/c', loadState: 'pending' }),
      make({
        name: '@scope/d',
        vulnerability: { count: 2, highestSeverity: 'high', advisories: [] },
      }),
    ]
    const agg = sm.getGroupAggregate(states, [0, 1, 2, 3])
    expect(agg.total).toBe(4)
    expect(agg.ready).toBe(3)
    expect(agg.pending).toBe(1)
    expect(agg.selectedRange).toBe(1)
    expect(agg.selectedLatest).toBe(1)
    expect(agg.selectedNone).toBe(2)
    expect(agg.hasRangeAvailable).toBe(2)
    expect(agg.hasMajorAvailable).toBe(1)
    expect(agg.vulnerable).toBe(1)
  })
})
