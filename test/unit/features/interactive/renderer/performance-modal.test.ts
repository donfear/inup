import { describe, expect, it } from 'vitest'
import { renderPerformanceModal } from '../../../../../src/features/interactive/renderer/performance-modal'
import { stripAnsi } from '../../../../../src/shared/terminal/text'
import { makeSnapshot } from '../../../../fixtures/performance-snapshot-factory'

const plain = (lines: string[]) => lines.map(stripAnsi).join('\n')

describe('renderPerformanceModal', () => {
  it('renders placeholders for an empty snapshot', () => {
    const result = renderPerformanceModal(makeSnapshot(), 100, 60)
    const text = plain(result.lines)

    expect(text).toContain('⚡ Performance')
    expect(text).toContain('Package manager: unknown')
    expect(text).toContain('(no batches recorded)')
    expect(text).toContain('(fixed — adaptive off or run too small)')
    expect(text).toContain('(none)')
    expect(text).toContain('—')
  })

  it('renders phase timings and elapsed total in milliseconds', () => {
    const snapshot = makeSnapshot({
      phases: {
        discovery: 12,
        depCollection: 34,
        filter: 5,
        registryFetch: 200,
        firstBatch: 220,
        allLoaded: 400,
      },
      totalMs: 400,
    })
    const text = plain(renderPerformanceModal(snapshot, 100, 60).lines)

    expect(text).toContain('Discovery')
    expect(text).toContain('12 ms')
    expect(text).toContain('Elapsed total')
    expect(text).toContain('400 ms')
  })

  it('renders package manager name when known', () => {
    const text = plain(
      renderPerformanceModal(makeSnapshot({ packageManager: 'pnpm' }), 100, 60).lines
    )

    expect(text).toContain('Package manager: pnpm')
  })

  it('computes batch average and slowest batch with its index', () => {
    const snapshot = makeSnapshot({
      batches: [
        { index: 0, size: 5, durationMs: 100, failedCount: 0 },
        { index: 1, size: 5, durationMs: 300, failedCount: 1 },
        { index: 2, size: 5, durationMs: 200, failedCount: 0 },
      ],
    })
    const text = plain(renderPerformanceModal(snapshot, 100, 60).lines)

    expect(text).toMatch(/Batch count\s+3/)
    expect(text).toMatch(/Avg batch\s+200 ms/)
    expect(text).toMatch(/Slowest batch\s+300 ms \(#1\)/)
  })

  it('summarizes concurrency control ticks', () => {
    const snapshot = makeSnapshot({
      controlTicks: [
        { atMs: 0, limit: 4, ewmaMs: 100, retries: 0, reason: 'up' },
        { atMs: 5, limit: 16, ewmaMs: 120, retries: 0, reason: 'up' },
        { atMs: 9, limit: 8, ewmaMs: 250, retries: 2, reason: 'hard-down' },
      ],
    })
    const text = plain(renderPerformanceModal(snapshot, 100, 60).lines)

    expect(text).toMatch(/Start limit\s+4/)
    expect(text).toMatch(/Peak limit\s+16/)
    expect(text).toMatch(/Final limit\s+8/)
    expect(text).toMatch(/Final EWMA\s+250 ms/)
    expect(text).toMatch(/Control ticks\s+3/)
    expect(text).toMatch(/Hard back-offs\s+1/)
    // Plain AIMD ticks carry no state — the modal labels the arm accordingly.
    expect(text).toMatch(/Controller\s+aimd/)
  })

  it('shows hill-climb state and goodput when the ticks carry them', () => {
    const snapshot = makeSnapshot({
      controlTicks: [
        { atMs: 0, limit: 8, ewmaMs: 700, retries: 0, reason: 'double', state: 'slow-start' },
        {
          atMs: 5,
          limit: 5,
          ewmaMs: 800,
          retries: 0,
          reason: 'step-down',
          state: 'hold',
          goodputRps: 9.5,
          revalidatedRatio: 0,
        },
      ],
    })
    const text = plain(renderPerformanceModal(snapshot, 100, 60).lines)

    expect(text).toMatch(/Controller\s+hillclimb/)
    expect(text).toMatch(/State\s+hold/)
    expect(text).toMatch(/Last goodput\s+9\.5\/s/)
  })

  it('lists each failed package with a cross mark', () => {
    const snapshot = makeSnapshot({ failedPackages: ['left-pad', 'is-odd'] })
    const text = plain(renderPerformanceModal(snapshot, 100, 60).lines)

    expect(text).toContain('✗ left-pad')
    expect(text).toContain('✗ is-odd')
  })

  it('does not scroll when the terminal is tall enough', () => {
    const result = renderPerformanceModal(makeSnapshot(), 100, 60)

    expect(result.usesInternalScroll).toBe(false)
    expect(result.maxScrollOffset).toBe(0)
    expect(plain(result.lines)).not.toContain('Lines ')
  })

  it('scrolls with a range footer when content overflows', () => {
    const result = renderPerformanceModal(makeSnapshot(), 100, 24, 0)

    expect(result.usesInternalScroll).toBe(true)
    expect(result.maxScrollOffset).toBeGreaterThan(0)
    expect(plain(result.lines)).toMatch(/Lines 1-\d+ of \d+/)
  })

  it('clamps the scroll offset to the maximum', () => {
    const atMax = renderPerformanceModal(makeSnapshot(), 100, 24, 999)
    const exact = renderPerformanceModal(makeSnapshot(), 100, 24, atMax.maxScrollOffset)

    expect(atMax.lines).toEqual(exact.lines)
    expect(plain(atMax.lines)).toContain(
      `Lines ${atMax.maxScrollOffset + 1}-${atMax.totalContentRows} of ${atMax.totalContentRows}`
    )
  })

  it('keeps a fixed frame height derived from the terminal height', () => {
    // fixedModalHeight = max(10, terminalHeight - 2), plus centering padding above.
    expect(renderPerformanceModal(makeSnapshot(), 100, 10).lines).toHaveLength(10)
    expect(renderPerformanceModal(makeSnapshot(), 100, 24).lines).toHaveLength(23)
  })

  it('clamps the modal width to 84 columns on wide terminals', () => {
    const result = renderPerformanceModal(makeSnapshot(), 120, 24)
    const border = stripAnsi(result.lines.find((line) => line.includes('╭'))!)

    expect(border.trimStart()).toHaveLength(84)
    expect(border).toHaveLength(Math.floor((120 - 84) / 2) + 84)
  })
})
