export type PerformancePhase =
  | 'firstBatch'
  | 'allLoaded'
  | 'discovery'
  | 'depCollection'
  | 'filter'
  | 'registryFetch'

export interface BatchTiming {
  index: number
  size: number
  durationMs: number
  failedCount: number
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

export interface PerformanceSnapshot {
  startedAt: number | null
  phases: Partial<Record<PerformancePhase, number>>
  totalMs: number | null
  counts: PerformanceCounts
  batches: BatchTiming[]
  failedPackages: string[]
  packageManager: string | null
}
