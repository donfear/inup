/**
 * Slow-start + hill-climb concurrency controller for slow links.
 *
 * The AIMD controller next door backs off only on real error signals (429/503,
 * transient failures). That is correct for congestion but blind to a slow yet
 * healthy pipe: it ramps to the ceiling and splits a narrow connection across
 * 24 sockets. This controller instead measures *goodput* — completions per
 * second over a window of requests we make anyway — and climbs the concurrency
 * hill toward the knee of the curve:
 *
 *  - SLOW_START: double the limit while a doubling still buys ≥25% goodput.
 *  - CLIMB_UP:   +1 per window while each step still buys ≥5%.
 *  - CLIMB_DOWN: when goodput is flat, fewer sockets do the same work — step
 *                −1 per window until throughput actually drops, then back up.
 *  - HOLD:       sit at the knee; step down only after two consecutive
 *                degraded windows; probe +1 occasionally to catch recovery.
 *  - VALIDATING: when starting from a persisted profile, confirm the network
 *                regime still matches before trusting the learned limit.
 *
 * Per-request latency NEVER drives a decision (the documented AIMD oscillation
 * failure was reacting to CDN latency variance). Latency is used exactly once:
 * the start-of-run regime check against a persisted baseline, with a 3× AND
 * ≥500ms bar that CDN jitter cannot clear. Decisions compare windowed goodput
 * with asymmetric hysteresis (+5% to move up, sustained −10% to move down in
 * HOLD), and steps are ±1 — worst-case oscillation amplitude is one slot.
 *
 * Error semantics are inherited from AIMD unchanged: congestion (429/503)
 * hard-halves the limit immediately; retryable errors in a window soft-decrease
 * (×0.7) at the tick and suppress any increase.
 *
 * Windows with a very different ETag-304 share are not compared: a 304 is
 * header-sized and fast even on a slow pipe, so a cache-mix shift would fake a
 * goodput change. The comparison baseline still rolls forward so decisions
 * resume on the next comparable window.
 */

import { POOL_CONNECTIONS } from '../config/constants'
import type { NetworkProfile } from '../types/domain'
import type {
  ConcurrencyController,
  ConcurrencyControllerState,
  ControlTick,
  ControlTickReason,
  RequestOutcomeKind,
  RequestOutcomeMeta,
} from './adaptive-controller'

export interface HillClimbTuning {
  /** Lower bound on the limit. */
  floor: number
  /** Upper bound on the limit (kept == the pool's connection count). */
  ceil: number
  /** Slow-start seed when there is no (valid) persisted profile. */
  coldStart: number
  /** Completions per goodput window; also the control-tick cadence. */
  windowCompletions: number
  /** Window-over-window gain that justifies another doubling. */
  strongGainFactor: number
  /** Minimum gain to accept any upward move (+1 step or probe). */
  gainEpsilon: number
  /** A down-step is kept only if goodput stayed at least this fraction. */
  keepDownEpsilon: number
  /** In HOLD, a window below this fraction of best counts as degraded. */
  holdDegradeFactor: number
  /** Consecutive degraded windows before HOLD steps down. */
  holdDegradeWindows: number
  /** Per-window decay of the best-goodput reference in HOLD. */
  bestGoodputDecay: number
  /** Healthy HOLD windows between upward probes. */
  reprobeAfterWindows: number
  /** Skip the decision when the 304 share shifted more than this between windows. */
  revalidatedComparableDelta: number
  /** EWMA smoothing for the latency instrumentation / regime check. */
  ewmaAlpha: number
  /** Multiplier on an error-driven soft decrease (AIMD semantics). */
  softDecreaseFactor: number
  /** Multiplier on a congestion-driven hard decrease (AIMD semantics). */
  hardDecreaseFactor: number
  /** Successes before the persisted profile is judged against live latency. */
  validateAfterCompletions: number
  /** Live EWMA must exceed baseline × this AND the absolute floor below… */
  regimeWorseFactor: number
  /** …this many ms, for the regime to count as changed. */
  regimeWorseMinMs: number
}

export const HILL_CLIMB_TUNING: HillClimbTuning = {
  // Below ~3 even a narrow pipe is underutilized (304s are header-sized).
  floor: 3,
  ceil: POOL_CONNECTIONS,
  coldStart: 4,
  // 12 completions average out npm CDN jitter within one window.
  windowCompletions: 12,
  strongGainFactor: 1.25,
  gainEpsilon: 1.05,
  // RTT-bound links lose ~1/L (≈4–13%) per removed slot → down-step rejected
  // immediately; bandwidth-bound links are flat → the count-down proceeds.
  keepDownEpsilon: 0.98,
  holdDegradeFactor: 0.9,
  holdDegradeWindows: 2,
  bestGoodputDecay: 0.98,
  reprobeAfterWindows: 6,
  revalidatedComparableDelta: 0.3,
  ewmaAlpha: 0.3,
  softDecreaseFactor: 0.7,
  hardDecreaseFactor: 0.5,
  validateAfterCompletions: 8,
  regimeWorseFactor: 3,
  regimeWorseMinMs: 500,
}

/** Runs below this size cannot close two windows plus a tail — skip control. */
const MIN_CONTROLLED_TOTAL = 30

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value))

const round2 = (value: number): number => Math.round(value * 100) / 100

export interface HillClimbOptions {
  /** Persisted starting hypothesis; validated against live latency, never a cap. */
  profile?: Pick<NetworkProfile, 'learnedLimit' | 'baselineLatencyMs'> | null
  /** Sink for control decisions (perf modal / logs). */
  onTick?: (tick: ControlTick) => void
  /** Override the defaults (tests / experiments). */
  tuning?: Partial<HillClimbTuning>
  /** Timestamp the run started; anchors the first goodput window. */
  startedAt?: number
}

export class HillClimbController implements ConcurrencyController {
  private readonly tuning: HillClimbTuning
  private readonly onTick?: (tick: ControlTick) => void

  private limit: number
  private phase: ConcurrencyControllerState
  private frozen = false

  // Latency EWMA: instrumentation plus the one-shot regime check — decisions
  // never read it (see the class docblock).
  private ewmaMs = 0
  private hasEwma = false
  private readonly profileBaselineMs: number | null = null
  private validationRemaining = 0

  private completionsSinceTick = 0
  private retriesSinceTick = 0
  private revalidatedSinceTick = 0
  private totalCompletions = 0
  private windowStartedAt: number
  private windowIndex = 0
  private lastHardDownWindow = Number.NEGATIVE_INFINITY

  /** Goodput and 304-share of the last closed comparable-or-rolled window. */
  private prevGoodput: number | null = null
  private prevRatio: number | null = null
  /** Cold start may double once without a baseline; any signal disarms it. */
  private blindDoubleArmed = false
  /** Limit before the last upward move, for a cheap revert. */
  private limitBeforeIncrease: number | null = null

  // HOLD bookkeeping.
  private bestGoodput = 0
  private badStreak = 0
  private windowsSinceProbe = 0
  private probePending = false
  private preProbeLimit = 0
  private probeBaseline = 0
  private reachedHold = false

  constructor(packageCount: number, options: HillClimbOptions = {}) {
    this.tuning = { ...HILL_CLIMB_TUNING, ...options.tuning }
    this.onTick = options.onTick
    const t = this.tuning
    const profile = options.profile ?? null
    if (profile) {
      this.limit = clamp(Math.round(profile.learnedLimit), t.floor, t.ceil)
      this.phase = 'validating'
      this.profileBaselineMs = profile.baselineLatencyMs
      this.validationRemaining = t.validateAfterCompletions
    } else {
      this.limit = clamp(t.coldStart, t.floor, t.ceil)
      this.phase = 'slow-start'
      this.blindDoubleArmed = true
    }
    // Never more parallel than there is work.
    this.limit = Math.min(this.limit, Math.max(1, packageCount))
    this.windowStartedAt = options.startedAt ?? Date.now()
  }

  /** Whether the controller should even run; tiny runs are better off fixed. */
  static shouldControl(packageCount: number): boolean {
    return packageCount >= MIN_CONTROLLED_TOTAL
  }

  getLimit(): number {
    return this.limit
  }

  getState(): ConcurrencyControllerState {
    return this.phase
  }

  /** Stop making decisions for the run tail: fewer in-flight requests than the
   * limit would read as a goodput collapse and poison the settled profile. */
  freeze(): void {
    this.frozen = true
  }

  /**
   * Record a completed request. Returns a new limit to apply IMMEDIATELY on a
   * congestion hard-decrease or a failed profile validation; otherwise null
   * (the limit may still change at the next window tick).
   */
  record(kind: RequestOutcomeKind, latencyMs?: number, meta?: RequestOutcomeMeta): number | null {
    this.completionsSinceTick++
    this.totalCompletions++

    if (kind === 'success') {
      if (meta?.revalidated) this.revalidatedSinceTick++
      if (latencyMs !== undefined) {
        this.sampleLatency(latencyMs)
        if (this.phase === 'validating') return this.validateProfile()
      }
      return null
    }

    this.retriesSinceTick++
    if (kind === 'congested') {
      return this.applyHardDecrease()
    }
    // retryable / transient: soft-decrease happens at the tick
    return null
  }

  /**
   * Call after each completion. Closes the goodput window when due and returns
   * the new limit if the decision changed it; otherwise null.
   */
  maybeTick(now: number = Date.now()): number | null {
    if (this.completionsSinceTick < this.tuning.windowCompletions) {
      return null
    }
    if (this.frozen) {
      this.resetWindow(now)
      return null
    }
    return this.tick(now)
  }

  /**
   * The learned network shape to persist, or null when this run settled
   * nothing trustworthy (never held, too few samples, or congestion at the
   * end — a mid-back-off limit is not a profile).
   */
  getSettledProfile(now: number = Date.now()): NetworkProfile | null {
    if (!this.reachedHold) return null
    if (this.totalCompletions < MIN_CONTROLLED_TOTAL) return null
    if (this.windowIndex - this.lastHardDownWindow < 2) return null
    return {
      schemaVersion: 1,
      learnedLimit: this.limit,
      baselineLatencyMs: Math.round(this.ewmaMs),
      baselineGoodputRps: round2(this.prevGoodput ?? 0),
      sampleCount: this.totalCompletions,
      updatedAt: new Date(now).toISOString(),
    }
  }

  private sampleLatency(latencyMs: number): void {
    if (!this.hasEwma) {
      this.ewmaMs = latencyMs
      this.hasEwma = true
    } else {
      const a = this.tuning.ewmaAlpha
      this.ewmaMs = a * latencyMs + (1 - a) * this.ewmaMs
    }
  }

  /** The one place latency decides anything: does the persisted profile still
   * describe this network? A 3× AND ≥500ms bar is far above CDN variance. */
  private validateProfile(): number | null {
    this.validationRemaining--
    if (this.validationRemaining > 0) return null
    const t = this.tuning
    const baseline = this.profileBaselineMs ?? 0
    const worse = this.ewmaMs > Math.max(t.regimeWorseFactor * baseline, t.regimeWorseMinMs)
    this.phase = 'slow-start'
    if (!worse) {
      // Regime matches (or improved — doubling will discover that): climb
      // from the learned limit, gated from the first comparison on.
      return null
    }
    // The profile is from a different network. Restart low and re-learn.
    this.limit = clamp(t.coldStart, t.floor, t.ceil)
    this.emit('regime-reset')
    return this.limit
  }

  private applyHardDecrease(): number {
    const t = this.tuning
    this.limit = clamp(Math.round(this.limit * t.hardDecreaseFactor), t.floor, t.ceil)
    this.enterHold(0)
    this.prevGoodput = null
    this.prevRatio = null
    this.blindDoubleArmed = false
    this.lastHardDownWindow = this.windowIndex
    this.emit('hard-down')
    // A hard decrease resets the window so we don't immediately move again.
    this.resetWindow(this.windowStartedAt)
    return this.limit
  }

  private tick(now: number): number | null {
    const t = this.tuning
    this.windowIndex++
    const before = this.limit
    const elapsedSec = Math.max((now - this.windowStartedAt) / 1000, 1e-6)
    const goodput = this.completionsSinceTick / elapsedSec
    const ratio = this.revalidatedSinceTick / this.completionsSinceTick

    let reason: ControlTickReason
    if (this.retriesSinceTick > 0) {
      // Errors in the window: AIMD soft-decrease, then re-establish a baseline
      // before climbing again (gated slow-start, like TCP after a loss).
      this.limit = clamp(Math.round(this.limit * t.softDecreaseFactor), t.floor, t.ceil)
      this.phase = 'slow-start'
      this.blindDoubleArmed = false
      this.probePending = false
      this.prevGoodput = null
      this.prevRatio = null
      reason = 'soft-down'
    } else if (
      this.prevRatio !== null &&
      Math.abs(ratio - this.prevRatio) > t.revalidatedComparableDelta
    ) {
      // Cache-mix shift: windows not comparable. Decide nothing, but roll the
      // baseline so the next same-mix window is comparable again.
      if (this.probePending) {
        this.probePending = false
        this.limit = this.preProbeLimit
        reason = 'probe-reject'
      } else {
        reason = 'hold'
      }
      this.prevGoodput = goodput
      this.prevRatio = ratio
    } else {
      reason = this.decide(goodput)
      this.prevGoodput = goodput
      this.prevRatio = ratio
    }

    this.emit(reason, now, goodput, ratio)
    this.resetWindow(now)
    return this.limit === before ? null : this.limit
  }

  private decide(goodput: number): ControlTickReason {
    switch (this.phase) {
      case 'slow-start':
        return this.decideSlowStart(goodput)
      case 'climb-up':
        return this.decideClimbUp(goodput)
      case 'climb-down':
        return this.decideClimbDown(goodput)
      default:
        return this.decideHold(goodput)
    }
  }

  private decideSlowStart(goodput: number): ControlTickReason {
    const t = this.tuning
    if (this.prevGoodput === null) {
      if (this.blindDoubleArmed) {
        // Cold start, no baseline yet: double optimistically — a wrong guess
        // costs one window and the next gate reverts it.
        this.blindDoubleArmed = false
        return this.increase(this.limit * 2, 'double', goodput)
      }
      return 'hold' // baseline established, comparisons start next window
    }
    const gain = goodput / this.prevGoodput
    if (gain >= t.strongGainFactor) {
      return this.increase(this.limit * 2, 'double', goodput)
    }
    if (gain >= t.gainEpsilon) {
      this.phase = 'climb-up'
      return this.increase(this.limit + 1, 'up', goodput)
    }
    // Plateau. If we just moved up, that move bought nothing — revert it and
    // probe below; otherwise (steady limit from a profile) count straight down.
    this.phase = 'climb-down'
    if (this.limitBeforeIncrease !== null && this.limitBeforeIncrease < this.limit) {
      this.limit = this.limitBeforeIncrease
      this.limitBeforeIncrease = null
      return 'revert'
    }
    this.limit = clamp(this.limit - 1, t.floor, t.ceil)
    return 'step-down'
  }

  private decideClimbUp(goodput: number): ControlTickReason {
    const t = this.tuning
    const gain = goodput / (this.prevGoodput ?? goodput)
    if (gain >= t.gainEpsilon) {
      return this.increase(this.limit + 1, 'up', goodput)
    }
    // The last +1 bought nothing: take it back and hold at the knee.
    const knee = this.prevGoodput ?? goodput
    this.limit = clamp(this.limit - 1, t.floor, t.ceil)
    this.enterHold(knee)
    return 'revert'
  }

  private decideClimbDown(goodput: number): ControlTickReason {
    const t = this.tuning
    const gain = goodput / (this.prevGoodput ?? goodput)
    if (gain >= t.keepDownEpsilon) {
      // Flat: fewer sockets, same throughput — keep descending.
      if (this.limit <= t.floor) {
        this.enterHold(goodput)
        return 'hold'
      }
      this.limit -= 1
      return 'step-down'
    }
    // Real loss: one step back up is the knee.
    const knee = this.prevGoodput ?? goodput
    this.limit = clamp(this.limit + 1, t.floor, t.ceil)
    this.enterHold(knee)
    return 'revert'
  }

  private decideHold(goodput: number): ControlTickReason {
    const t = this.tuning
    if (this.probePending) {
      this.probePending = false
      const gain = goodput / this.probeBaseline
      if (gain >= t.gainEpsilon) {
        // The probe bought real throughput — keep climbing.
        this.phase = 'climb-up'
        return this.increase(this.limit + 1, 'up', goodput)
      }
      this.limit = this.preProbeLimit
      this.windowsSinceProbe = 0
      return 'probe-reject'
    }

    this.bestGoodput = Math.max(this.bestGoodput * t.bestGoodputDecay, goodput)
    if (goodput < t.holdDegradeFactor * this.bestGoodput) {
      this.badStreak++
      if (this.badStreak >= t.holdDegradeWindows) {
        this.badStreak = 0
        this.bestGoodput = goodput
        if (this.limit > t.floor) {
          this.limit -= 1
          return 'step-down'
        }
      }
      return 'hold'
    }

    this.badStreak = 0
    this.windowsSinceProbe++
    if (this.windowsSinceProbe >= t.reprobeAfterWindows && this.limit < t.ceil) {
      this.probePending = true
      this.preProbeLimit = this.limit
      this.probeBaseline = goodput
      this.windowsSinceProbe = 0
      this.limit = clamp(this.limit + 1, t.floor, t.ceil)
      return 'probe-up'
    }
    return 'hold'
  }

  private increase(target: number, reason: ControlTickReason, goodput: number): ControlTickReason {
    const t = this.tuning
    this.limitBeforeIncrease = this.limit
    this.limit = clamp(target, t.floor, t.ceil)
    if (this.limit === t.ceil) {
      this.enterHold(goodput)
    }
    return reason
  }

  private enterHold(referenceGoodput: number): void {
    this.phase = 'hold'
    this.reachedHold = true
    this.bestGoodput = referenceGoodput
    this.badStreak = 0
    this.windowsSinceProbe = 0
    this.probePending = false
    this.limitBeforeIncrease = null
  }

  private emit(
    reason: ControlTickReason,
    now: number = Date.now(),
    goodput?: number,
    ratio?: number
  ): void {
    this.onTick?.({
      atMs: now,
      limit: this.limit,
      ewmaMs: Math.round(this.ewmaMs),
      retries: this.retriesSinceTick,
      reason,
      state: this.phase,
      ...(goodput !== undefined && ratio !== undefined
        ? { goodputRps: round2(goodput), revalidatedRatio: Math.round(ratio * 1000) / 1000 }
        : {}),
    })
  }

  private resetWindow(now: number): void {
    this.completionsSinceTick = 0
    this.retriesSinceTick = 0
    this.revalidatedSinceTick = 0
    this.windowStartedAt = now
  }
}
