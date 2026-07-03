import type { PerformanceSnapshot } from '../../src/features/debug'

export function makeSnapshot(overrides?: Partial<PerformanceSnapshot>): PerformanceSnapshot {
  return {
    startedAt: null,
    phases: {},
    totalMs: null,
    counts: {},
    batches: [],
    controlTicks: [],
    packageTimings: [],
    failedPackages: [],
    packageManager: null,
    ...overrides,
  }
}
