export type PerformancePhase =
  'firstBatch' | 'allLoaded' | 'discovery' | 'depCollection' | 'filter' | 'registryFetch'

export interface BatchTiming {
  index: number
  size: number
  durationMs: number
  failedCount: number
}

export type ControlTickReason = 'up' | 'soft-down' | 'hard-down' | 'hold'

/** One adaptive-concurrency control decision (separate channel from BatchTiming). */
export interface ControlTick {
  atMs: number
  limit: number
  ewmaMs: number
  retries: number
  reason: ControlTickReason
}

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
  batches: BatchTiming[]
  controlTicks: ControlTick[]
  packageTimings: PackageTiming[]
  failedPackages: string[]
  packageManager: string | null
}
