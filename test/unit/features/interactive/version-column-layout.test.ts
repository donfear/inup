import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computeVersionColumnWidths,
  VersionColumnLayout,
} from '../../../../src/features/interactive/renderer/package-list'
import { VersionUtils } from '../../../../src/features/interactive/renderer/version-format'
import { makeSelectionState } from '../../../fixtures/selection-state-factory'

afterEach(() => vi.restoreAllMocks())

describe('VersionColumnLayout', () => {
  it('measures each arrival exactly once, however many frames are drawn', () => {
    const measure = vi.spyOn(VersionUtils, 'getVisualLength')
    const arrivals = Array.from({ length: 1000 }, () => makeSelectionState())
    const layout = new VersionColumnLayout()

    layout.get(arrivals, 120)
    const afterFirstFrame = measure.mock.calls.length
    expect(afterFirstFrame).toBeGreaterThan(0)

    // Idle frames (cursor, selection, filters) measure nothing.
    layout.get(arrivals, 120)
    layout.get(arrivals, 120)
    expect(measure).toHaveBeenCalledTimes(afterFirstFrame)

    // Streaming frames measure only the rows that are new.
    arrivals.push(makeSelectionState(), makeSelectionState())
    layout.get(arrivals, 120)
    const perRow = afterFirstFrame / 1000
    expect(measure.mock.calls.length - afterFirstFrame).toBe(perRow * 2)
  })

  it('matches the one-shot computation over the same rows', () => {
    const rows = [
      makeSelectionState({ currentVersionSpecifier: '^1.0.0' }),
      makeSelectionState({
        currentVersionSpecifier: '^16.0.0-preview.10',
        rangeVersion: '16.0.0-preview.12',
        latestVersion: '17.0.0-canary.3',
      }),
      makeSelectionState({ loadState: 'pending' }),
    ]

    expect(new VersionColumnLayout().get(rows, 100)).toEqual(computeVersionColumnWidths(rows, 100))
  })

  it('keeps the same widths object until a row widens a column or the terminal resizes', () => {
    const arrivals = [makeSelectionState({ selectedOption: 'range' })]
    const layout = new VersionColumnLayout()
    const initial = layout.get(arrivals, 160)

    arrivals.push(makeSelectionState({ name: 'same-shape' }))
    expect(layout.get(arrivals, 160)).toBe(initial)

    arrivals.push(makeSelectionState({ currentVersionSpecifier: '^123.456.789-preview.123' }))
    const widened = layout.get(arrivals, 160)
    expect(widened).not.toBe(initial)
    expect(widened.current).toBeGreaterThan(initial.current)

    const resized = layout.get(arrivals, 80)
    expect(resized).not.toBe(widened)
    expect(resized.current).toBe(16)
    expect(layout.get(arrivals, 80)).toBe(resized)
  })
})
