import {
  BatchTiming,
  PerformanceCounts,
  PerformancePhase,
  PerformanceSnapshot,
} from '../types/debug.types'

class PerformanceTracker {
  private startedAt: number | null = null
  private phases: Partial<Record<PerformancePhase, number>> = {}
  private counts: PerformanceCounts = {}
  private batches: BatchTiming[] = []
  private failedPackages: string[] = []
  private packageManager: string | null = null

  start(): void {
    this.startedAt = Date.now()
    this.phases = {}
    this.counts = {}
    this.batches = []
    this.failedPackages = []
    this.packageManager = null
  }

  mark(phase: PerformancePhase): void {
    if (this.startedAt === null || this.phases[phase] !== undefined) return
    this.phases[phase] = Date.now() - this.startedAt
  }

  recordPhaseDuration(phase: PerformancePhase, durationMs: number): void {
    this.phases[phase] = durationMs
  }

  recordCounts(partial: Partial<PerformanceCounts>): void {
    this.counts = { ...this.counts, ...partial }
  }

  recordBatch(batch: BatchTiming): void {
    this.batches.push(batch)
  }

  recordFailedPackage(name: string): void {
    if (!this.failedPackages.includes(name)) {
      this.failedPackages.push(name)
    }
  }

  setPackageManager(name: string): void {
    this.packageManager = name
  }

  snapshot(): PerformanceSnapshot {
    const totalMs =
      this.startedAt === null
        ? null
        : (this.phases.allLoaded ?? Date.now() - this.startedAt)
    return {
      startedAt: this.startedAt,
      phases: { ...this.phases },
      totalMs,
      counts: { ...this.counts },
      batches: [...this.batches],
      failedPackages: [...this.failedPackages],
      packageManager: this.packageManager,
    }
  }

  reset(): void {
    this.startedAt = null
    this.phases = {}
    this.counts = {}
    this.batches = []
    this.failedPackages = []
    this.packageManager = null
  }
}

let instance: PerformanceTracker | null = null

export function getPerformanceTracker(): PerformanceTracker {
  if (!instance) instance = new PerformanceTracker()
  return instance
}
