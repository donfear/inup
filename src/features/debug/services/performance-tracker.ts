import { PerformancePhase, PerformanceSnapshot } from '../types/debug.types'

class PerformanceTracker {
  private startedAt: number | null = null
  private phases: Partial<Record<PerformancePhase, number>> = {}

  start(): void {
    this.startedAt = Date.now()
    this.phases = {}
  }

  mark(phase: PerformancePhase): void {
    if (this.startedAt === null || this.phases[phase] !== undefined) return
    this.phases[phase] = Date.now() - this.startedAt
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
    }
  }

  reset(): void {
    this.startedAt = null
    this.phases = {}
  }
}

let instance: PerformanceTracker | null = null

export function getPerformanceTracker(): PerformanceTracker {
  if (!instance) instance = new PerformanceTracker()
  return instance
}
