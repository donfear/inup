import type { ControlTick } from '../../shared/http/controller-contract'

export type PerformancePhase =
  | 'firstResult'
  | 'allLoaded'
  | 'discovery'
  | 'depCollection'
  | 'filter'
  | 'registryFetch'

// One adaptive-concurrency control decision (separate channel from PackageTiming).
// The canonical definitions live with the controllers; re-exported here so the
// perf tracker/modal and the controllers can never drift apart structurally.
export type {
  ConcurrencyControllerState,
  ControlTick,
  ControlTickReason,
} from '../../shared/http/controller-contract'

export interface PerformanceCounts {
  packageJsonFiles?: number
  rawDependencies?: number
  uniquePackages?: number
  ignoredPackages?: number
  workspaceRefsSkipped?: number
  resolved?: number
  failed?: number
}

/** Per-package network latency (successful single-attempt round-trip). */
export interface PackageTiming {
  name: string
  latencyMs: number
}

export interface PerformanceSnapshot {
  startedAt: number | null
  phases: Partial<Record<PerformancePhase, number>>
  totalMs: number | null
  counts: PerformanceCounts
  controlTicks: ControlTick[]
  packageTimings: PackageTiming[]
  failedPackages: string[]
  packageManager: string | null
}
