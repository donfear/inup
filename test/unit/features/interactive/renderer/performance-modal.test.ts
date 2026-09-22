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
    expect(text).toContain('(no registry responses timed yet)')
    expect(text).toContain('(fixed — pinned or run too small)')
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
        firstResult: 220,
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

  it('summarizes per-package registry latency with average, p95, and the slowest package', () => {
    const snapshot = makeSnapshot({
      packageTimings: [
        { name: 'fast', latencyMs: 100 },
        { name: 'slow', latencyMs: 300 },
        { name: 'mid', latencyMs: 200 },
      ],
    })
    const text = plain(renderPerformanceModal(snapshot, 100, 60).lines)

    expect(text).toMatch(/Packages timed\s+3/)
    expect(text).toMatch(/Avg\s+200 ms/)
    expect(text).toMatch(/p95\s+300 ms/)
    expect(text).toMatch(/Slowest\s+300 ms \(slow\)/)
  })

  it('reports nearest-rank p95 from the sorted latencies, not the arrival order', () => {
    // 20 samples with latencies 0..19 in scrambled order: nearest-rank p95 is
    // the 19th smallest (index 18), one below the maximum.
    const timings = Array.from({ length: 20 }, (_, i) => ({
      name: `pkg-${i}`,
      latencyMs: (i * 7) % 20,
    }))
    const text = plain(
      renderPerformanceModal(makeSnapshot({ packageTimings: timings }), 100, 60).lines
    )

    expect(text).toMatch(/p95\s+18 ms/)
    expect(text).toMatch(/Slowest\s+19 ms \(pkg-17\)/)
  })

  it('does not let one outlier become the p95 of a small sample', () => {
    const timings = [
      ...Array.from({ length: 19 }, (_, i) => ({ name: `ok-${i}`, latencyMs: 200 })),
      { name: 'stalled', latencyMs: 8000 },
    ]
    const text = plain(
      renderPerformanceModal(makeSnapshot({ packageTimings: timings }), 100, 60).lines
    )

    expect(text).toMatch(/p95\s+200 ms/)
    expect(text).toMatch(/Slowest\s+8000 ms \(stalled\)/)
  })

  it('summarizes concurrency control ticks', () => {
    const snapshot = makeSnapshot({
      controlTicks: [
        { atMs: 0, limit: 4, ewmaMs: 100, retries: 0, reason: 'up', state: 'climb-up' },
        { atMs: 5, limit: 16, ewmaMs: 120, retries: 0, reason: 'up', state: 'climb-up' },
        { atMs: 9, limit: 8, ewmaMs: 250, retries: 2, reason: 'hard-down', state: 'hold' },
      ],
    })
    const text = plain(renderPerformanceModal(snapshot, 100, 60).lines)

    expect(text).toMatch(/Start limit\s+4/)
    expect(text).toMatch(/Peak limit\s+16/)
    expect(text).toMatch(/Final limit\s+8/)
    expect(text).toMatch(/Final EWMA\s+250 ms/)
    expect(text).toMatch(/Control ticks\s+3/)
    expect(text).toMatch(/Hard back-offs\s+1/)
  })

  it('shows bytes goodput in MB/s and flags a fast-link hold', () => {
    const snapshot = makeSnapshot({
      controlTicks: [
        {
          atMs: 0,
          limit: 24,
          ewmaMs: 120,
          retries: 0,
          reason: 'hold',
          state: 'hold',
          goodputBps: 5_747_126.44,
          revalidatedRatio: 0,
          fastLink: true,
        },
      ],
    })
    const text = stripAnsi(renderPerformanceModal(snapshot, 100, 60).lines.join('\n'))
    expect(text).toMatch(/State\s+hold \(fast link\)/)
    expect(text).toMatch(/Last goodput\s+5\.7 MB\/s/)
  })

  it('shows the controller state and goodput', () => {
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

    expect(text).toMatch(/State\s+hold/)
    expect(text).toMatch(/Last goodput\s+9\.5\/s/)
  })

  it('renders a goodput placeholder when the final tick carries no window data', () => {
    // A hard-down decides from the error alone, so its tick has no goodput.
    const snapshot = makeSnapshot({
      controlTicks: [
        { atMs: 0, limit: 8, ewmaMs: 700, retries: 0, reason: 'double', state: 'slow-start' },
        { atMs: 5, limit: 4, ewmaMs: 900, retries: 1, reason: 'hard-down', state: 'hold' },
      ],
    })
    const text = plain(renderPerformanceModal(snapshot, 100, 60).lines)

    expect(text).toMatch(/State\s+hold/)
    expect(text).toMatch(/Last goodput\s+—/)
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
