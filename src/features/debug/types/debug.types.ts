export type PerformancePhase = 'firstBatch' | 'allLoaded'

export interface PerformanceSnapshot {
  startedAt: number | null
  phases: Partial<Record<PerformancePhase, number>>
  totalMs: number | null
}
