import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPerformanceTracker } from '../../../../src/features/debug'

// getPerformanceTracker returns a module-level singleton, so every test starts
// from a clean slate and leaves real timers behind.
const tracker = getPerformanceTracker()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  tracker.reset()
})

afterEach(() => {
  tracker.reset()
  vi.useRealTimers()
})

describe('PerformanceTracker', () => {
  it('returns the same singleton instance', () => {
    expect(getPerformanceTracker()).toBe(tracker)
  })

  it('ignores marks before start', () => {
    tracker.mark('discovery')

    const snapshot = tracker.snapshot()
    expect(snapshot.startedAt).toBeNull()
    expect(snapshot.phases).toEqual({})
    expect(snapshot.totalMs).toBeNull()
  })

  it('records the elapsed time for the first mark of each phase only', () => {
    tracker.start()
    vi.advanceTimersByTime(50)
    tracker.mark('discovery')
    vi.advanceTimersByTime(100)
    tracker.mark('discovery')

    expect(tracker.snapshot().phases.discovery).toBe(50)
  })

  it('uses the allLoaded phase as total when marked', () => {
    tracker.start()
    vi.advanceTimersByTime(80)
    tracker.mark('allLoaded')
    vi.advanceTimersByTime(500)

    expect(tracker.snapshot().totalMs).toBe(80)
  })

  it('falls back to elapsed wall time when allLoaded was never marked', () => {
    tracker.start()
    vi.advanceTimersByTime(120)

    expect(tracker.snapshot().totalMs).toBe(120)
  })

  it('overrides phases via recordPhaseDuration even before start', () => {
    tracker.recordPhaseDuration('registryFetch', 42)

    expect(tracker.snapshot().phases.registryFetch).toBe(42)
  })

  it('merges counts across calls', () => {
    tracker.recordCounts({ packageJsonFiles: 2 })
    tracker.recordCounts({ resolved: 10 })

    expect(tracker.snapshot().counts).toEqual({ packageJsonFiles: 2, resolved: 10 })
  })

  it('collects batches, control ticks, and package timings', () => {
    tracker.recordBatch({ index: 0, size: 5, durationMs: 100, failedCount: 0 })
    tracker.recordControlTick({ atMs: 1, limit: 8, ewmaMs: 90, retries: 0, reason: 'up' })
    tracker.recordPackageTiming({ name: 'demo', latencyMs: 33 })

    const snapshot = tracker.snapshot()
    expect(snapshot.batches).toHaveLength(1)
    expect(snapshot.controlTicks).toHaveLength(1)
    expect(snapshot.packageTimings).toEqual([{ name: 'demo', latencyMs: 33 }])
  })

  it('deduplicates failed packages', () => {
    tracker.recordFailedPackage('left-pad')
    tracker.recordFailedPackage('left-pad')
    tracker.recordFailedPackage('is-odd')

    expect(tracker.snapshot().failedPackages).toEqual(['left-pad', 'is-odd'])
  })

  it('records the package manager', () => {
    tracker.setPackageManager('pnpm')

    expect(tracker.snapshot().packageManager).toBe('pnpm')
  })

  it('returns defensive copies from snapshot', () => {
    tracker.recordBatch({ index: 0, size: 5, durationMs: 100, failedCount: 0 })

    const snapshot = tracker.snapshot()
    snapshot.batches.push({ index: 1, size: 1, durationMs: 1, failedCount: 0 })
    snapshot.failedPackages.push('ghost')

    expect(tracker.snapshot().batches).toHaveLength(1)
    expect(tracker.snapshot().failedPackages).toEqual([])
  })

  it('start resets all previously collected data', () => {
    tracker.start()
    tracker.mark('discovery')
    tracker.recordFailedPackage('left-pad')
    tracker.setPackageManager('npm')

    tracker.start()

    const snapshot = tracker.snapshot()
    expect(snapshot.phases).toEqual({})
    expect(snapshot.failedPackages).toEqual([])
    expect(snapshot.packageManager).toBeNull()
  })

  it('reset clears the start timestamp', () => {
    tracker.start()
    tracker.reset()

    expect(tracker.snapshot().startedAt).toBeNull()
    expect(tracker.snapshot().totalMs).toBeNull()
  })
})
