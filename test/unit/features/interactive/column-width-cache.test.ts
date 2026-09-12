import { afterEach, describe, expect, it, vi } from 'vitest'
import { VersionColumnWidthCache } from '../../../../src/features/interactive/renderer/package-list'
import { VersionUtils } from '../../../../src/features/interactive/renderer/version-format'
import { makeSelectionState } from '../../../fixtures/selection-state-factory'

afterEach(() => vi.restoreAllMocks())

describe('VersionColumnWidthCache', () => {
  it('reuses layout across cursor/selection renders without measuring every state again', () => {
    const measure = vi.spyOn(VersionUtils, 'getVisualLength')
    const states = Array.from({ length: 1000 }, () => makeSelectionState())
    const cache = new VersionColumnWidthCache()
    const initial = cache.get(states, 120, 0, '')
    const calls = measure.mock.calls.length

    states[0].selectedOption = 'latest'
    // Filtering returns fresh arrays even when membership is unchanged.
    expect(cache.get([...states], 120, 0, '')).toBe(initial)
    expect(measure).toHaveBeenCalledTimes(calls)
  })

  it('remeasures for data revisions, width changes, and filter changes', () => {
    const cache = new VersionColumnWidthCache()
    const states = [makeSelectionState()]
    const initial = cache.get(states, 160, 0, '')
    states[0].currentVersionSpecifier = '^123.456.789-preview.123'
    const changed = cache.get(states, 160, 1, '')
    expect(changed.current).toBeGreaterThan(initial.current)
    const resized = cache.get(states, 80, 1, '')
    expect(resized.current).toBe(16)
    expect(resized).not.toBe(changed)
    const filtered = cache.get([], 80, 1, 'no matches')
    expect(filtered).not.toBe(resized)
    expect(cache.get([], 80, 1, 'no matches')).toBe(filtered)
  })
})
