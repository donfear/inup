/**
 * AIMD (additive-increase / multiplicative-decrease) concurrency controller.
 *
 * Mirrors the congestion-control family TCP uses. It does not perform any I/O or
 * own the semaphore — it is a pure decision function: feed it the outcome of each
 * request, and on each control tick it returns the next concurrency limit. The
 * caller applies that to the resizable semaphore.
 *
 * Signals (highest quality first):
 *  - congestion (HTTP 429/503): the registry explicitly telling us to slow down →
 *    immediate hard multiplicative-decrease (*0.5), applied the moment the signal
 *    arrives, not deferred to the next tick.
 *  - retryable/transient errors: counted; any in a tick blocks an increase and
 *    triggers a soft decrease.
 *  - success latency (EWMA): rising past a factor of the recent baseline → soft
 *    decrease (*0.7). Stable/improving with no errors → additive increase (+2).
 *
 * Latency is sampled ONLY from successful single attempts (see npm-registry's
 * attemptRegistryFetch). Retry backoff sleeps are never timed, so they cannot
 * corrupt the EWMA.
 */

export interface AdaptiveTuning {
  floor: number
  ceil: number
  /** Additive step when healthy. */
  increaseStep: number
  /** Multiplier for a latency-driven soft decrease. */
  softDecreaseFactor: number
  /** Multiplier for a congestion-driven hard decrease. */
  hardDecreaseFactor: number
  /** EWMA smoothing factor (0..1); higher = more reactive. */
  ewmaAlpha: number
  /** Ratio of current EWMA to baseline EWMA above which we call it "degrading". */
  latencyDegradeRatio: number
  /** Completions between control ticks. */
  ticksEveryCompletions: number
}

export const DEFAULT_TUNING: AdaptiveTuning = {
  floor: 3,
  ceil: 24,
  increaseStep: 2,
  softDecreaseFactor: 0.7,
  hardDecreaseFactor: 0.5,
  ewmaAlpha: 0.3,
  latencyDegradeRatio: 1.5,
  ticksEveryCompletions: 8,
}

export type ControlTickReason = 'up' | 'soft-down' | 'hard-down' | 'hold'

export interface ControlTick {
  atMs: number
  limit: number
  ewmaMs: number
  retries: number
  reason: ControlTickReason
}

export type RequestOutcomeKind = 'success' | 'congested' | 'retryable' | 'transient'

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value))

export class AdaptiveController {
  private readonly tuning: AdaptiveTuning
  private limit: number

  private ewmaMs = 0
  private hasEwma = false
  /** Slow-moving baseline the live EWMA is compared against to detect drift. */
  private baselineMs = 0
  private hasBaseline = false

  private completionsSinceTick = 0
  private retriesSinceTick = 0

  private peakLimit: number
  private tickCount = 0

  /**
   * @param packageCount   number of packages this run will fetch; drives the
   *                        smart initial limit so small runs don't crawl up from
   *                        the floor and lose to a fixed baseline.
   * @param onTick         optional sink for instrumentation (perf modal).
   * @param tuning         override the defaults (constants live in one place).
   * @param startOverride  optional explicit starting limit (e.g. a caller's
   *                        maxConcurrency). The controller still ramps from here;
   *                        it just doesn't smart-start above it.
   */
  constructor(
    packageCount: number,
    private readonly onTick?: (tick: ControlTick) => void,
    tuning: Partial<AdaptiveTuning> = {},
    startOverride?: number
  ) {
    this.tuning = { ...DEFAULT_TUNING, ...tuning }
    // Smart start: never aim below the floor, never above what there is to do or
    // the ceiling. A 12-package run starts near 12, not at 3. An explicit
    // override caps the starting point lower (the controller ramps up from it).
    const smartStart = Math.min(this.tuning.ceil, packageCount)
    const desiredStart =
      startOverride !== undefined ? Math.min(smartStart, startOverride) : smartStart
    const start = clamp(desiredStart, this.tuning.floor, this.tuning.ceil)
    this.limit = start
    this.peakLimit = start
  }

  /** Whether the controller should even run; tiny runs are better off fixed. */
  static shouldControl(packageCount: number, tuning: Partial<AdaptiveTuning> = {}): boolean {
    const ceil = tuning.ceil ?? DEFAULT_TUNING.ceil
    // Nothing to ramp toward and no steady state to learn below the ceiling.
    return packageCount > ceil
  }

  getLimit(): number {
    return this.limit
  }

  getPeakLimit(): number {
    return this.peakLimit
  }

  getTickCount(): number {
    return this.tickCount
  }

  /**
   * Record a completed request. Returns a new limit to apply IMMEDIATELY when a
   * congestion signal demands a hard back-off, otherwise null (the limit may
   * still change at the next control tick — see `maybeTick`).
   */
  record(kind: RequestOutcomeKind, latencyMs?: number): number | null {
    this.completionsSinceTick++

    if (kind === 'success' && latencyMs !== undefined) {
      this.sampleLatency(latencyMs)
      return null
    }

    if (kind === 'congested') {
      this.retriesSinceTick++
      return this.applyHardDecrease()
    }

    // retryable / transient
    this.retriesSinceTick++
    return null
  }

  /**
   * Call after each completion. If a control tick is due, computes and returns
   * the next limit (and emits a ControlTick); otherwise returns null.
   */
  maybeTick(now: number = Date.now()): number | null {
    if (this.completionsSinceTick < this.tuning.ticksEveryCompletions) {
      return null
    }
    return this.tick(now)
  }

  private sampleLatency(latencyMs: number): void {
    if (!this.hasEwma) {
      this.ewmaMs = latencyMs
      this.hasEwma = true
    } else {
      const a = this.tuning.ewmaAlpha
      this.ewmaMs = a * latencyMs + (1 - a) * this.ewmaMs
    }
    if (!this.hasBaseline) {
      this.baselineMs = this.ewmaMs
      this.hasBaseline = true
    }
  }

  private applyHardDecrease(): number {
    const next = clamp(
      Math.round(this.limit * this.tuning.hardDecreaseFactor),
      this.tuning.floor,
      this.tuning.ceil
    )
    this.limit = next
    this.emit('hard-down')
    // A hard decrease resets the tick window so we don't immediately bump back up.
    this.resetWindow()
    return next
  }

  private tick(now: number): number {
    const retries = this.retriesSinceTick
    const degrading =
      this.hasBaseline &&
      this.baselineMs > 0 &&
      this.ewmaMs > this.baselineMs * this.tuning.latencyDegradeRatio

    let reason: ControlTickReason
    if (retries > 0 || degrading) {
      this.limit = clamp(
        Math.round(this.limit * this.tuning.softDecreaseFactor),
        this.tuning.floor,
        this.tuning.ceil
      )
      reason = 'soft-down'
    } else if (this.limit < this.tuning.ceil) {
      this.limit = clamp(this.limit + this.tuning.increaseStep, this.tuning.floor, this.tuning.ceil)
      reason = 'up'
    } else {
      reason = 'hold'
    }

    // Let the baseline track the live EWMA slowly so a sustained, legitimately
    // slower link becomes the new "normal" instead of forcing perpetual back-off.
    if (this.hasEwma) {
      this.baselineMs = this.hasBaseline ? 0.5 * this.ewmaMs + 0.5 * this.baselineMs : this.ewmaMs
      this.hasBaseline = true
    }

    this.emit(reason, now)
    this.resetWindow()
    return this.limit
  }

  private emit(reason: ControlTickReason, now: number = Date.now()): void {
    this.peakLimit = Math.max(this.peakLimit, this.limit)
    this.tickCount++
    this.onTick?.({
      atMs: now,
      limit: this.limit,
      ewmaMs: Math.round(this.ewmaMs),
      retries: this.retriesSinceTick,
      reason,
    })
  }

  private resetWindow(): void {
    this.completionsSinceTick = 0
    this.retriesSinceTick = 0
  }
}
