/**
 * Slow-start + hill-climb concurrency controller for slow links.
 *
 * A plain AIMD controller backs off only on real error signals (429/503,
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
 * Per-request latency NEVER drives a decision (latency-driven AIMD oscillates
 * on CDN latency variance). Latency is used exactly once: the start-of-run
 * regime check against a persisted baseline, with a 3× AND ≥500ms bar that
 * CDN jitter cannot clear. Decisions compare windowed goodput
 * with asymmetric hysteresis (+5% to move up, sustained −10% to move down in
 * HOLD), and steps are ±1 — worst-case oscillation amplitude is one slot.
 *
 * Error semantics are classic AIMD: congestion (429/503) hard-halves the limit
 * immediately; retryable errors in a window soft-decrease (×0.7) at the tick
 * and suppress any increase.
 *
 * Windows with a very different ETag-304 share are not compared: a 304 is
 * header-sized and fast even on a slow pipe, so a cache-mix shift would fake a
 * goodput change. The comparison baseline still rolls forward so decisions
 * resume on the next comparable window.
 */

import { POOL_CONNECTIONS } from '../config/constants'
import { clamp, Ewma, round2, roundTo } from '../math'
import type { NetworkProfile } from '../types/domain'

export type ControlTickReason =
  | 'up'
  | 'soft-down'
  | 'hard-down'
  | 'hold'
  | 'double'
  | 'revert'
  | 'step-down'
  | 'probe-up'
  | 'probe-reject'
  | 'regime-reset'

export type ConcurrencyControllerState =
  | 'validating'
  | 'slow-start'
  | 'climb-up'
  | 'climb-down'
  | 'hold'

/** One control decision, reported to the perf tracker and the performance modal. */
export interface ControlTick {
  atMs: number
  limit: number
  ewmaMs: number
  retries: number
  reason: ControlTickReason
  /** Controller phase after the decision. */
  state: ConcurrencyControllerState
  /** Window goodput (completions/sec), when the window was measured in completions. */
  goodputRps?: number
  /** Share of ETag-304 revalidations in the window (0..1). */
  revalidatedRatio?: number
  /** Window goodput in streamed response bytes/sec, when the window was measured
   * in bytes (mostly full downloads). */
  goodputBps?: number
  /** True while the controller holds the ceiling because the link proved fast. */
  fastLink?: boolean
}

export type RequestOutcomeKind = 'success' | 'congested' | 'retryable' | 'transient'

export interface RequestOutcomeMeta {
  /** True when the response was an ETag 304 revalidation (tiny and fast even on a slow pipe). */
  revalidated?: boolean
  /** Compressed response bytes received (0 for a 304). */
  bytes?: number
}

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
  /** …this many ms, for the regime to count as changed for the worse. */
  regimeWorseMinMs: number
  /** A better regime needs the same ratio AND at least this much absolute
   * improvement — two fast states differing by a few ms are the same regime. */
  regimeBetterMinDeltaMs: number
  /** Streamed bytes/sec at or above which the link is held at the ceiling. */
  fastLinkBytesPerSec: number
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
  regimeBetterMinDeltaMs: 200,
  // 8 Mbit/s: 8× the 1 Mbit/s profile this controller exists for, and a pipe
  // that wide is never hurt by 24 sockets. Below it, goodput decides.
  fastLinkBytesPerSec: 1_000_000,
}

/** Runs below this size cannot close two windows plus a tail — skip control. */
const MIN_CONTROLLED_TOTAL = 30

/** What a window's goodput counts: completions (warm, 304-dominated) or
 * streamed bytes (cold, download-dominated). */
type WindowMetric = 'bytes' | 'completions'

/** Full (non-304) fetches needed before a latency baseline is worth persisting.
 * A 304 is header-sized and fast on any link; a baseline diluted by 304s would
 * poison the next run's regime check in either direction. */
const MIN_BASELINE_SAMPLES = 4

export interface HillClimbOptions {
  /** Persisted starting hypothesis; validated against live latency, never a cap. */
  profile?: Pick<NetworkProfile, 'learnedLimit' | 'baselineLatencyMs'> | null
  /** Sink for control decisions (perf modal / logs). */
  onTick?: (tick: ControlTick) => void
  /** Timestamp the run started; anchors the first goodput window. */
  startedAt?: number
}

export class HillClimbController {
  private readonly tuning: HillClimbTuning = HILL_CLIMB_TUNING
  private readonly onTick?: (tick: ControlTick) => void

  private limit: number
  private phase: ConcurrencyControllerState
  private frozen = false

  // Latency EWMA over ALL successes: instrumentation only (perf modal / logs).
  private readonly latencyEwma: Ewma
  // Latency EWMA over FULL fetches only (no 304s): feeds the regime check and
  // the persisted baseline. A 304 is fast on any link, so mixing it in would
  // let a cache-mix shift impersonate a network change.
  private readonly fullLatencyEwma: Ewma
  private readonly profileBaselineMs: number | null = null
  private validationRemaining = 0
  private validatingWindows = 0

  private completionsSinceTick = 0
  private retriesSinceTick = 0
  private revalidatedSinceTick = 0
  /** Compressed response bytes streamed during the current window. Full
   * downloads vary ~200× in size, so cold windows are measured in bytes, not
   * completions — see tick(). */
  private bytesSinceWindow = 0
  private prevMetric: WindowMetric | null = null
  /** Holding the ceiling because streamed throughput proved the link is wide. */
  private fastLink = false
  /** Window index before which fast link may not (re-)engage — set by the
   * error paths so a registry back-off is honored, not immediately undone. */
  private fastLinkSuppressedUntilWindow = 0
  /** Successful completions (attempts that failed do not count as evidence). */
  private totalCompletions = 0
  private windowStartedAt: number
  private windowIndex = 0
  private lastHardDownWindow = Number.NEGATIVE_INFINITY
  /** A hard-down reset the counters mid-window but record() has no clock to
   * reset the window start — the next tick must discard that half-timed window. */
  private windowClockDirty = false

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
    this.onTick = options.onTick
    const t = this.tuning
    this.latencyEwma = new Ewma(t.ewmaAlpha)
    this.fullLatencyEwma = new Ewma(t.ewmaAlpha)
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
    // Never more parallel than there is work. This may land below `floor`
    // for tiny runs; harmless today because shouldControl() gates runs < 30,
    // but the floor invariant does NOT survive a caller that skips the gate.
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

    if (kind === 'success') {
      this.totalCompletions++
      const revalidated = meta?.revalidated === true
      if (revalidated) this.revalidatedSinceTick++
      if (latencyMs !== undefined) {
        this.latencyEwma.update(latencyMs)
        if (!revalidated) {
          this.fullLatencyEwma.update(latencyMs)
          // Only full fetches inform the regime check: a warm-cache 304 looks
          // fast on the slowest of links.
          if (this.phase === 'validating') return this.validateProfile()
        }
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

  /** Account streamed response bytes for the current window. */
  recordBytes(bytes: number): void {
    this.bytesSinceWindow += bytes
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
    // No trustworthy latency baseline (all-304 warm run): persist nothing —
    // better to keep last run's profile than to store one that cannot be
    // regime-checked next time.
    if (this.fullLatencyEwma.count < MIN_BASELINE_SAMPLES) return null
    return {
      schemaVersion: 1,
      learnedLimit: this.limit,
      baselineLatencyMs: Math.round(this.fullLatencyEwma.value),
      baselineGoodputRps: round2(this.prevGoodput ?? 0),
      sampleCount: this.totalCompletions,
      updatedAt: new Date(now).toISOString(),
    }
  }

  /** The one place latency decides anything: does the persisted profile still
   * describe this network? The check is symmetric. Worse (3× AND ≥500ms —
   * far above CDN variance): the learned limit would strangle a slow link.
   * Better (3× AND ≥200ms improvement): the learned limit would drag a fast
   * link — from a profile the start is gated, so same-limit windows read as a
   * plateau and the controller would climb DOWN, recovering only by probes.
   * Either way the profile is from a different network: restart and re-learn. */
  private validateProfile(): number | null {
    this.validationRemaining--
    if (this.validationRemaining > 0) return null
    const t = this.tuning
    // The 'validating' phase only exists when a profile was supplied, and the
    // constructor sets the baseline together with it; the fallback is for the
    // field's nullable type only.
    /* v8 ignore start */
    const baseline = this.profileBaselineMs ?? 0
    /* v8 ignore stop */
    // Full-fetch latency on both sides of the comparison: the stored baseline
    // is full-fetch-only too (getSettledProfile), so a cache-mix difference
    // between the runs cannot impersonate a network change.
    const fullMs = this.fullLatencyEwma.value
    const worse = fullMs > Math.max(t.regimeWorseFactor * baseline, t.regimeWorseMinMs)
    const better =
      baseline - fullMs > t.regimeBetterMinDeltaMs && fullMs * t.regimeWorseFactor < baseline
    this.phase = 'slow-start'
    if (!worse && !better) {
      // Same regime: climb from the learned limit, gated from here on.
      return null
    }
    this.limit = clamp(t.coldStart, t.floor, t.ceil)
    // On a better regime the cold start may double blindly (the link is fast;
    // a wrong guess costs one window). On a worse one, stay gated.
    this.blindDoubleArmed = better
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
    // The registry asked us to slow down: a fast pipe is no excuse. Re-learn,
    // and do not let fast link snap the limit back for a while.
    this.fastLink = false
    this.prevMetric = null
    this.fastLinkSuppressedUntilWindow = this.windowIndex + this.tuning.reprobeAfterWindows
    this.emit('hard-down')
    // Reset the window counters so we don't immediately move again. record()
    // has no clock to restart the window timer, so the current window's
    // elapsed time is wrong — mark it and let the next tick discard it.
    this.resetWindow(this.windowStartedAt)
    this.windowClockDirty = true
    return this.limit
  }

  private tick(now: number): number | null {
    const t = this.tuning
    const before = this.limit
    const measurable = now > this.windowStartedAt && !this.windowClockDirty
    this.windowClockDirty = false

    // Errors in the window: AIMD soft-decrease, then re-establish a baseline
    // before climbing again (gated slow-start, like TCP after a loss). The
    // signal is the errors themselves — no goodput needed, so this branch
    // runs even for a window whose elapsed time is unmeasurable.
    // Validation is NOT abandoned: flaky links are exactly where the regime
    // check matters, and errors say nothing about the latency comparison.
    if (this.retriesSinceTick > 0) {
      this.windowIndex++
      this.limit = clamp(Math.round(this.limit * t.softDecreaseFactor), t.floor, t.ceil)
      if (this.phase !== 'validating') this.phase = 'slow-start'
      this.blindDoubleArmed = false
      this.probePending = false
      this.prevGoodput = null
      this.prevRatio = null
      this.prevMetric = null
      // Errors in the window outrank a fast-link hold: drop it and keep it off
      // for two clean windows so the soft decrease actually takes effect.
      this.fastLink = false
      this.fastLinkSuppressedUntilWindow = this.windowIndex + 3
      // The pre-error revert point is stale now — a later plateau must step
      // ±1 from the post-soft-down limit, never snap back across it.
      this.limitBeforeIncrease = null
      // No goodput fields on this tick: the window's timing may be invalid,
      // and the soft-down decision never reads it anyway.
      this.emit('soft-down', now)
      this.resetWindow(now)
      return this.limit === before ? null : this.limit
    }

    // Unmeasurable clean window: the clock did not move forward (zero or
    // backward step — Date.now() is not monotonic) or the window straddles a
    // hard-down whose timer could not be restarted. No goodput can be derived;
    // decide nothing and let the next full window re-establish the baseline.
    if (!measurable) {
      this.resetWindow(now)
      return null
    }

    this.windowIndex++
    const elapsedSec = (now - this.windowStartedAt) / 1000
    const ratio = this.revalidatedSinceTick / this.completionsSinceTick
    const bytesPerSec = this.bytesSinceWindow / elapsedSec

    // Fast link: streamed throughput this high means the pipe is not narrow,
    // and a wide pipe is never hurt by the full pool. Hold the ceiling and stop
    // deciding — every clean window, whatever its 304 share — until an error
    // path clears it. Checked before the goodput metric so a 75%-304 window
    // with three big downloads still counts.
    if (
      this.fastLink ||
      (this.windowIndex >= this.fastLinkSuppressedUntilWindow &&
        bytesPerSec >= t.fastLinkBytesPerSec)
    ) {
      if (!this.fastLink) {
        this.fastLink = true
        this.limit = t.ceil
        this.enterHold(bytesPerSec)
      }
      this.prevGoodput = null
      this.prevRatio = null
      this.prevMetric = null
      this.emit('hold', now, bytesPerSec, ratio, 'bytes')
      this.resetWindow(now)
      return this.limit === before ? null : this.limit
    }

    // A 304 is header-sized while a full packument can be megabytes, so
    // completions/sec only measures a window whose responses are alike. Warm
    // (mostly-304) windows count completions; cold windows count bytes — when
    // the caller streams them (a body read without accounting stays on
    // completions rather than reading as zero throughput).
    const metric: WindowMetric = ratio < 0.5 && this.bytesSinceWindow > 0 ? 'bytes' : 'completions'
    const goodput = metric === 'bytes' ? bytesPerSec : this.completionsSinceTick / elapsedSec
    const metricChanged = this.prevMetric !== null && this.prevMetric !== metric
    this.prevMetric = metric

    let reason: ControlTickReason
    if (this.phase === 'validating') {
      // A clean window closed but the latency check is still short of full
      // fetches — a warm cache serves mostly 304s. One more window of grace,
      // then trust the learned limit: a warm run is cheap at any limit and
      // the goodput gates take over from here.
      this.validatingWindows++
      if (this.validatingWindows >= 2) {
        this.phase = 'slow-start'
      }
      this.prevGoodput = goodput
      this.prevRatio = ratio
      reason = 'hold'
    } else if (
      this.prevRatio !== null &&
      (metricChanged || Math.abs(ratio - this.prevRatio) > t.revalidatedComparableDelta)
    ) {
      // Cache-mix shift (or bytes ↔ completions switch): windows not comparable. Decide nothing, but roll the
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

    this.emit(reason, now, goodput, ratio, metric)
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
    // Climb states are only entered from a decided (comparable) window, so a
    // baseline always exists; the fallback only guards impossible-null math.
    /* v8 ignore start */
    const prev = this.prevGoodput ?? goodput
    /* v8 ignore stop */
    const gain = goodput / prev
    if (gain >= t.gainEpsilon) {
      return this.increase(this.limit + 1, 'up', goodput)
    }
    // The last +1 bought nothing: take it back and hold at the knee.
    this.limit = clamp(this.limit - 1, t.floor, t.ceil)
    this.enterHold(prev)
    return 'revert'
  }

  private decideClimbDown(goodput: number): ControlTickReason {
    const t = this.tuning
    // Same invariant as decideClimbUp: the baseline is always present here.
    /* v8 ignore start */
    const prev = this.prevGoodput ?? goodput
    /* v8 ignore stop */
    const gain = goodput / prev
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
    this.limit = clamp(this.limit + 1, t.floor, t.ceil)
    this.enterHold(prev)
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
    ratio?: number,
    metric: WindowMetric = 'completions'
  ): void {
    this.onTick?.({
      atMs: now,
      limit: this.limit,
      ewmaMs: Math.round(this.latencyEwma.value),
      retries: this.retriesSinceTick,
      reason,
      state: this.phase,
      ...(goodput !== undefined && ratio !== undefined
        ? {
            ...(metric === 'bytes'
              ? { goodputBps: round2(goodput) }
              : { goodputRps: round2(goodput) }),
            revalidatedRatio: roundTo(ratio, 3),
          }
        : {}),
      ...(this.fastLink ? { fastLink: true } : {}),
    })
  }

  private resetWindow(now: number): void {
    this.completionsSinceTick = 0
    this.retriesSinceTick = 0
    this.revalidatedSinceTick = 0
    this.bytesSinceWindow = 0
    this.windowStartedAt = now
  }
}
