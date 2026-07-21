/**
 * AIMD (additive-increase / multiplicative-decrease) concurrency controller.
 *
 * Mirrors the congestion-control family TCP uses. It performs no I/O and does not
 * own the semaphore — it is a pure decision function: feed it the outcome of each
 * request, and on each control tick it returns the next concurrency limit, which
 * the caller applies to the resizable semaphore.
 *
 * Back-off signals (only real errors move the limit down):
 *  - congestion (HTTP 429/503): the registry explicitly telling us to slow down →
 *    immediate hard multiplicative-decrease (×hardDecreaseFactor), the moment the
 *    signal arrives, not deferred to the next tick.
 *  - retryable/transient errors in a tick window → soft multiplicative-decrease
 *    (×softDecreaseFactor) and no increase.
 *
 * Otherwise (healthy link) the limit ramps additively (+increaseStep) toward the
 * ceiling and holds there.
 *
 * NOTE on latency: we sample successful single-attempt latency into an EWMA, but
 * it is used for *instrumentation only* — never to drive back-off. The npm
 * registry is a CDN whose latency varies widely on a perfectly healthy link;
 * reacting to that variance made the controller oscillate and lose to a fixed
 * limit. Real congestion shows up as 429, which we handle directly.
 */

import { clamp, Ewma } from '../math'
import type {
  ConcurrencyController,
  ControlTick,
  ControlTickReason,
  RequestOutcomeKind,
} from './controller-contract'

export type {
  ConcurrencyController,
  ConcurrencyControllerState,
  ControlTick,
  ControlTickReason,
  RequestOutcomeKind,
  RequestOutcomeMeta,
} from './controller-contract'

export interface AdaptiveTuning {
  /** Lower bound on the limit. */
  floor: number
  /** Upper bound on the limit (kept == the pool's connection count). */
  ceil: number
  /** Additive step when healthy. */
  increaseStep: number
  /** Multiplier on a soft (error-driven) decrease. */
  softDecreaseFactor: number
  /** Multiplier on a hard (congestion-driven) decrease. */
  hardDecreaseFactor: number
  /** EWMA smoothing factor (0..1) for the reported latency metric. */
  ewmaAlpha: number
  /** Completions between control ticks. */
  ticksEveryCompletions: number
}

export const DEFAULT_TUNING: AdaptiveTuning = {
  floor: 6,
  ceil: 24,
  increaseStep: 4,
  softDecreaseFactor: 0.7,
  hardDecreaseFactor: 0.5,
  ewmaAlpha: 0.3,
  ticksEveryCompletions: 6,
}

export class AdaptiveController implements ConcurrencyController {
  private readonly tuning: AdaptiveTuning
  private limit: number

  // EWMA of successful single-attempt latency. Kept for instrumentation only
  // (the perf modal / logs); it does not drive concurrency decisions.
  private readonly latencyEwma: Ewma

  private completionsSinceTick = 0
  private retriesSinceTick = 0

  /**
   * @param packageCount  number of packages this run will fetch; drives the smart
   *                       initial limit so a run starts near its work size and
   *                       ramps to the ceiling, rather than crawling up from the
   *                       floor and losing to a fixed baseline.
   * @param onTick        optional sink for control decisions (perf modal / logs).
   * @param tuning        override the defaults (constants live in one place).
   */
  constructor(
    packageCount: number,
    private readonly onTick?: (tick: ControlTick) => void,
    tuning: Partial<AdaptiveTuning> = {}
  ) {
    this.tuning = { ...DEFAULT_TUNING, ...tuning }
    this.latencyEwma = new Ewma(this.tuning.ewmaAlpha)
    // Smart start: aim at the work size, clamped to [floor, ceil].
    this.limit = clamp(
      Math.min(this.tuning.ceil, packageCount),
      this.tuning.floor,
      this.tuning.ceil
    )
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

  /**
   * Record a completed request. Returns a new limit to apply IMMEDIATELY when a
   * congestion signal demands a hard back-off, otherwise null (the limit may
   * still change at the next control tick — see `maybeTick`).
   */
  record(kind: RequestOutcomeKind, latencyMs?: number): number | null {
    this.completionsSinceTick++

    if (kind === 'success' && latencyMs !== undefined) {
      this.latencyEwma.update(latencyMs)
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
    // Back off only on real errors seen since the last tick; otherwise ramp to
    // the ceiling and hold (latency is not a signal — see the class docblock).
    const retries = this.retriesSinceTick

    let reason: ControlTickReason
    if (retries > 0) {
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

    this.emit(reason, now)
    this.resetWindow()
    return this.limit
  }

  private emit(reason: ControlTickReason, now: number = Date.now()): void {
    this.onTick?.({
      atMs: now,
      limit: this.limit,
      ewmaMs: Math.round(this.latencyEwma.value),
      retries: this.retriesSinceTick,
      reason,
    })
  }

  private resetWindow(): void {
    this.completionsSinceTick = 0
    this.retriesSinceTick = 0
  }
}
