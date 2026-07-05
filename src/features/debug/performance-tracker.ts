import type {
  BatchTiming,
  ControlTick,
  PackageTiming,
  PerformanceCounts,
  PerformancePhase,
  PerformanceSnapshot,
} from './types'

class PerformanceTracker {
  private startedAt: number | null = null
  private phases: Partial<Record<PerformancePhase, number>> = {}
  private counts: PerformanceCounts = {}
  private batches: BatchTiming[] = []
  private controlTicks: ControlTick[] = []
  private packageTimings: PackageTiming[] = []
  private failedPackages: string[] = []
  private packageManager: string | null = null

  start(): void {
    this.startedAt = Date.now()
    this.phases = {}
    this.counts = {}
    this.batches = []
    this.controlTicks = []
    this.packageTimings = []
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

  recordControlTick(tick: ControlTick): void {
    this.controlTicks.push(tick)
  }

  recordPackageTiming(timing: PackageTiming): void {
    this.packageTimings.push(timing)
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
      this.startedAt === null ? null : (this.phases.allLoaded ?? Date.now() - this.startedAt)
    return {
      startedAt: this.startedAt,
      phases: { ...this.phases },
      totalMs,
      counts: { ...this.counts },
      batches: [...this.batches],
      controlTicks: [...this.controlTicks],
      packageTimings: [...this.packageTimings],
      failedPackages: [...this.failedPackages],
      packageManager: this.packageManager,
    }
  }

  reset(): void {
    this.startedAt = null
    this.phases = {}
    this.counts = {}
    this.batches = []
    this.controlTicks = []
    this.packageTimings = []
    this.failedPackages = []
    this.packageManager = null
  }
}

let instance: PerformanceTracker | null = null

export function getPerformanceTracker(): PerformanceTracker {
  if (!instance) instance = new PerformanceTracker()
  return instance
}
