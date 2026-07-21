import { describe, expect, it } from 'vitest'
import type { ControlTick } from '../../../../src/shared/http/adaptive-controller'
import {
  HILL_CLIMB_TUNING,
  HillClimbController,
} from '../../../../src/shared/http/hill-climb-controller'
import type { NetworkProfile } from '../../../../src/shared/types/domain'

// The default tuning, restated so the assertions below read as concrete math.
const T = HILL_CLIMB_TUNING

const START_AT = 1_000

const makeClock = () => {
  let t = START_AT
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
      return t
    },
  }
}

type Harness = {
  c: HillClimbController
  ticks: ControlTick[]
  clock: ReturnType<typeof makeClock>
}

const makeController = (opts: {
  packageCount?: number
  profile?: Pick<NetworkProfile, 'learnedLimit' | 'baselineLatencyMs'> | null
}): Harness => {
  const ticks: ControlTick[] = []
  const clock = makeClock()
  const c = new HillClimbController(opts.packageCount ?? 300, {
    profile: opts.profile ?? null,
    onTick: (t) => ticks.push(t),
    startedAt: START_AT,
  })
  return { c, ticks, clock }
}

/** Record `count` successes; returns the last immediate limit change (if any). */
const feed = (
  c: HillClimbController,
  count: number,
  latencyMs: number | ((i: number) => number) = 100,
  revalidatedCount = 0
): number | null => {
  let last: number | null = null
  for (let i = 0; i < count; i++) {
    const latency = typeof latencyMs === 'function' ? latencyMs(i) : latencyMs
    const next = c.record('success', latency, { revalidated: i < revalidatedCount })
    if (next !== null) last = next
  }
  return last
}

/**
 * Close one goodput window: feed `count` completions (default: a full window),
 * advance the clock by `elapsedMs`, and tick. Window goodput is therefore
 * `windowCompletions / (elapsedMs / 1000)` when the window had a full 12.
 */
const closeWindow = (
  h: Harness,
  elapsedMs: number,
  opts: {
    count?: number
    latencyMs?: number | ((i: number) => number)
    revalidatedCount?: number
  } = {}
): number | null => {
  feed(h.c, opts.count ?? T.windowCompletions, opts.latencyMs ?? 100, opts.revalidatedCount ?? 0)
  return h.c.maybeTick(h.clock.advance(elapsedMs))
}

const reasons = (h: Harness) => h.ticks.map((t) => t.reason)

describe('HillClimbController', () => {
  describe('shouldControl', () => {
    it('requires at least 30 packages (2 windows + tail headroom)', () => {
      expect(HillClimbController.shouldControl(29)).toBe(false)
      expect(HillClimbController.shouldControl(30)).toBe(true)
    })
  })

  describe('tuning invariants', () => {
    it('keeps the ceiling equal to the pool connection count', () => {
      expect(T.ceil).toBe(24)
      expect(T.floor).toBe(3)
      expect(T.coldStart).toBe(4)
    })
  })

  describe('slow start (cold)', () => {
    it('starts at coldStart and doubles to the ceiling while goodput keeps improving', () => {
      const h = makeController({})
      expect(h.c.getLimit()).toBe(T.coldStart)

      // First window has no baseline: cold start doubles blindly (a wrong guess
      // costs one window; the next gate catches it).
      expect(closeWindow(h, 1200)).toBe(8) // goodput 10/s
      expect(closeWindow(h, 600)).toBe(16) // goodput 20/s → 2.0× ≥ strongGainFactor
      expect(closeWindow(h, 300)).toBe(24) // goodput 40/s → 2.0× → 2×16 clamped to ceil
      expect(reasons(h)).toEqual(['double', 'double', 'double'])
      expect(h.c.getState()).toBe('hold')
    })

    it('downshifts from doubling to +1 climbing on a moderate gain', () => {
      const h = makeController({})
      expect(closeWindow(h, 1200)).toBe(8) // blind double, goodput 10/s
      // 12/s: 1.2× — real improvement, but below the doubling gate. Doubling
      // again would overshoot; probe upward one step at a time instead.
      expect(closeWindow(h, 1000)).toBe(9)
      expect(h.c.getState()).toBe('climb-up')
      expect(h.ticks.at(-1)?.reason).toBe('up')
    })

    it('reverts the last double and starts counting down when goodput plateaus', () => {
      const h = makeController({})
      expect(closeWindow(h, 1200)).toBe(8) // blind double, goodput 10/s
      // Same goodput at twice the parallelism: the pipe is saturated.
      expect(closeWindow(h, 1200)).toBe(4) // gain 1.0 < gainEpsilon → revert
      expect(reasons(h)).toEqual(['double', 'revert'])
      expect(h.c.getState()).toBe('climb-down')
    })

    it('ignores per-request latency jitter while window goodput is stable (no oscillation)', () => {
      const h = makeController({})
      const jitter = (i: number) => (i % 2 === 0 ? 1 : 25)
      closeWindow(h, 1200, { latencyMs: jitter }) // → 8
      closeWindow(h, 480, { latencyMs: jitter }) // 25/s, 2.5× → 16
      closeWindow(h, 260, { latencyMs: jitter }) // 46/s → 24 (ceil)
      for (let i = 0; i < 7; i++) {
        closeWindow(h, 220, { latencyMs: jitter }) // stable ~54.5/s
      }
      expect(h.c.getLimit()).toBe(24)
      const downs = reasons(h).filter((r) =>
        ['step-down', 'revert', 'soft-down', 'hard-down'].includes(r)
      )
      expect(downs).toEqual([])
    })
  })

  describe('climb-down (the 7→6→5 count-down)', () => {
    it('steps down while goodput stays flat and reverts on the first real loss', () => {
      // Start from a learned limit of 8 so the numbers match the user scenario.
      const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 100 } })
      feed(h.c, T.validateAfterCompletions, 100) // validation passes (100ms ≈ baseline)
      expect(h.c.getLimit()).toBe(8)

      // First window from a profile establishes a baseline — no blind double.
      expect(closeWindow(h, 1200, { count: 4 })).toBe(null) // 12 total (8 validation + 4)
      expect(h.ticks[0].reason).toBe('hold')

      expect(closeWindow(h, 1200)).toBe(7) // plateau at same limit → start descending
      expect(h.c.getState()).toBe('climb-down')
      expect(closeWindow(h, 1220)).toBe(6) // 9.84/s vs 10/s = 0.984 ≥ keepDownEpsilon
      expect(closeWindow(h, 1230)).toBe(5) // 9.76/s vs 9.84/s = 0.992 ≥ keepDownEpsilon
      expect(closeWindow(h, 1500)).toBe(6) // 8.0/s vs 9.76/s = 0.82 → real loss, revert
      expect(h.c.getState()).toBe('hold')
      expect(reasons(h)).toEqual(['hold', 'step-down', 'step-down', 'step-down', 'revert'])
    })

    it('rejects the first down-step immediately on an RTT-bound link', () => {
      const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 100 } })
      feed(h.c, T.validateAfterCompletions, 100)
      closeWindow(h, 1200, { count: 4 }) // baseline 10/s at 8
      closeWindow(h, 1200) // plateau → 7, climb-down
      // RTT-bound: goodput ∝ limit, so 7 connections do 7/8 of the work.
      expect(closeWindow(h, 1371)).toBe(8) // 8.75/s vs 10/s = 0.875 < 0.98 → revert
      expect(h.c.getState()).toBe('hold')
    })
  })

  describe('hold', () => {
    /** Drive a controller into HOLD at limit 8 with best goodput 10/s. */
    const settleAtHold = (): Harness => {
      const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 100 } })
      feed(h.c, T.validateAfterCompletions, 100)
      closeWindow(h, 1200, { count: 4 }) // baseline 10/s
      closeWindow(h, 1200) // plateau → 7, climb-down
      closeWindow(h, 1371) // RTT-bound loss → revert to 8, HOLD, best = 10/s
      h.ticks.length = 0
      return h
    }

    it('steps down only after two consecutive degraded windows', () => {
      const h = settleAtHold()
      closeWindow(h, 1412) // 8.5/s < 0.9 × (10 × 0.98 decay) = 8.82 → strike one
      expect(h.c.getLimit()).toBe(8)
      expect(h.ticks[0].reason).toBe('hold')
      closeWindow(h, 1412) // 8.5/s < 0.9 × 9.604 = 8.64 → strike two
      expect(h.c.getLimit()).toBe(7)
      expect(h.ticks[1].reason).toBe('step-down')
    })

    it('a single degraded window between healthy ones never moves the limit', () => {
      const h = settleAtHold()
      closeWindow(h, 1412) // degraded once
      closeWindow(h, 1200) // healthy again → streak resets
      closeWindow(h, 1412) // degraded once more — still only one in a row
      expect(h.c.getLimit()).toBe(8)
      expect(reasons(h)).not.toContain('step-down')
    })

    it('decays the best-goodput reference so a stale lucky window cannot force step-downs', () => {
      const h = settleAtHold()
      // 15 quiet windows at 9.3/s (93% of the old best): decay floors the
      // reference at the current level, so nothing ever looks degraded.
      for (let i = 0; i < 15; i++) closeWindow(h, 1290)
      expect(reasons(h)).not.toContain('step-down')
      expect(h.c.getLimit()).toBeGreaterThanOrEqual(8) // probes may nudge it up
    })

    it('probes upward after reprobeAfterWindows and keeps the gain when real', () => {
      const h = settleAtHold()
      for (let i = 0; i < T.reprobeAfterWindows - 1; i++) closeWindow(h, 1200)
      expect(reasons(h)).not.toContain('probe-up')
      closeWindow(h, 1200) // reprobe timer fires
      expect(reasons(h)).toContain('probe-up')
      expect(h.c.getLimit()).toBe(9)
      closeWindow(h, 1000) // 12/s vs 10/s = 1.2 ≥ gainEpsilon → accepted, keep climbing
      expect(h.c.getLimit()).toBe(10)
      expect(h.c.getState()).toBe('climb-up')
    })

    it('rejects a probe that bought nothing', () => {
      const h = settleAtHold()
      for (let i = 0; i < T.reprobeAfterWindows; i++) closeWindow(h, 1200)
      expect(h.c.getLimit()).toBe(9) // probing
      closeWindow(h, 1200) // 10/s vs 10/s → no gain
      expect(h.c.getLimit()).toBe(8)
      expect(reasons(h)).toContain('probe-reject')
      expect(h.c.getState()).toBe('hold')
    })
  })

  describe('error handling (unchanged AIMD semantics)', () => {
    it('halves the limit immediately on congestion, from any state', () => {
      const h = makeController({ profile: { learnedLimit: 16, baselineLatencyMs: 100 } })
      const immediate = h.c.record('congested')
      expect(immediate).toBe(8) // 16 × 0.5, applied now, not at the next tick
      expect(h.c.getLimit()).toBe(8)
      expect(h.c.getState()).toBe('hold')
    })

    it('soft-decreases at the tick when the window saw retryable errors', () => {
      const h = makeController({ profile: { learnedLimit: 10, baselineLatencyMs: 100 } })
      feed(h.c, T.windowCompletions - 1, 100)
      h.c.record('retryable')
      const ticked = h.c.maybeTick(h.clock.advance(1200))
      expect(ticked).toBe(7) // 10 × 0.7
      expect(h.ticks.at(-1)?.reason).toBe('soft-down')
      // The next clean window only re-establishes a baseline — no instant re-climb.
      expect(closeWindow(h, 1200)).toBe(null)
      expect(h.ticks.at(-1)?.reason).toBe('hold')
    })
  })

  describe('ETag 304 comparability guard', () => {
    it('skips the decision when the revalidated share shifts, then resumes', () => {
      const h = makeController({})
      closeWindow(h, 1200) // blind double → 8, ratio 0
      // Warm-cache burst: 10/12 are 304s — fast, but not comparable to window 1.
      closeWindow(h, 300, { revalidatedCount: 10 })
      expect(h.c.getLimit()).toBe(8) // decision skipped
      expect(h.ticks.at(-1)?.reason).toBe('hold')
      // Same mix again: comparable → gating resumes against the rolled baseline.
      closeWindow(h, 200, { revalidatedCount: 10 }) // 60/s vs 40/s = 1.5× → double
      expect(h.c.getLimit()).toBe(16)
    })
  })

  describe('freeze (run tail)', () => {
    it('stops making decisions once frozen', () => {
      const h = makeController({})
      closeWindow(h, 1200) // → 8
      h.c.freeze()
      const ticked = closeWindow(h, 300) // would have doubled
      expect(ticked).toBe(null)
      expect(h.c.getLimit()).toBe(8)
      expect(h.ticks).toHaveLength(1)
    })
  })

  describe('settled profile', () => {
    it('returns the settled limit once HOLD was reached', () => {
      const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 100 } })
      feed(h.c, T.validateAfterCompletions, 100)
      closeWindow(h, 1200, { count: 4 })
      closeWindow(h, 1200) // → 7, climb-down
      closeWindow(h, 1371) // revert → 8, HOLD  (36 completions total)
      h.c.freeze()
      const profile = h.c.getSettledProfile(5_000_000)
      expect(profile).not.toBeNull()
      expect(profile?.schemaVersion).toBe(1)
      expect(profile?.learnedLimit).toBe(8)
      expect(profile?.baselineLatencyMs).toBe(100)
      expect(profile?.sampleCount).toBeGreaterThanOrEqual(30)
      expect(profile?.updatedAt).toBe(new Date(5_000_000).toISOString())
    })

    it('returns null when HOLD was never reached', () => {
      const h = makeController({})
      closeWindow(h, 1200) // still slow-starting
      h.c.freeze()
      expect(h.c.getSettledProfile(5_000_000)).toBeNull()
    })

    it('returns null when congestion hit in the final windows', () => {
      const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 100 } })
      feed(h.c, T.validateAfterCompletions, 100)
      closeWindow(h, 1200, { count: 4 })
      closeWindow(h, 1200)
      closeWindow(h, 1371) // HOLD at 8
      h.c.record('congested') // hard-down in the current window
      closeWindow(h, 1200, { count: T.windowCompletions - 1 })
      h.c.freeze()
      expect(h.c.getSettledProfile(5_000_000)).toBeNull()
    })
  })

  describe('profile validation at run start', () => {
    it('resets to coldStart when the network regime is drastically worse', () => {
      const h = makeController({ profile: { learnedLimit: 16, baselineLatencyMs: 120 } })
      expect(h.c.getLimit()).toBe(16)
      const immediate = feed(h.c, T.validateAfterCompletions, 900)
      // 900ms EWMA > max(3 × 120, 500) → the profile is a lie here; restart low.
      expect(immediate).toBe(T.coldStart)
      expect(h.c.getLimit()).toBe(T.coldStart)
      expect(h.c.getState()).toBe('slow-start')
      expect(reasons(h)).toContain('regime-reset')
    })

    it('keeps the learned limit when the regime matches', () => {
      const h = makeController({ profile: { learnedLimit: 16, baselineLatencyMs: 120 } })
      feed(h.c, T.validateAfterCompletions, 110)
      expect(h.c.getLimit()).toBe(16)
      expect(reasons(h)).not.toContain('regime-reset')
    })

    it('resets on a drastically FASTER network too (a stuck-low profile would drag a fast link)', () => {
      // Symmetric regime check: from a profile the controller starts gated, so
      // two windows at the same limit read as a plateau and it would climb DOWN
      // from a learned slow-café limit even on fast home wifi. A much-better
      // regime therefore discards the profile and re-learns via cold slow-start.
      const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 400 } })
      const immediate = feed(h.c, T.validateAfterCompletions, 20)
      expect(immediate).toBe(T.coldStart)
      expect(reasons(h)).toContain('regime-reset')
      // Cold restart re-arms the blind double: fast links reach the ceiling in
      // 3 windows instead of crawling up by probe.
      closeWindow(h, 1200)
      expect(h.c.getLimit()).toBe(T.coldStart * 2)
    })

    it('keeps the profile when latency merely improved a little', () => {
      // 150 → 100ms: below the better-regime delta — not worth re-learning.
      const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 150 } })
      feed(h.c, T.validateAfterCompletions, 100)
      expect(h.c.getLimit()).toBe(8)
      expect(reasons(h)).not.toContain('regime-reset')
    })

    it('keeps the profile when the improvement misses the ratio gate', () => {
      // 400 → 160ms: big delta but not 3× better — same regime, keep the limit.
      const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 400 } })
      feed(h.c, T.validateAfterCompletions, 160)
      expect(h.c.getLimit()).toBe(8)
      expect(reasons(h)).not.toContain('regime-reset')
    })

    it('clamps an out-of-range learned limit into [floor, ceil]', () => {
      const h = makeController({ profile: { learnedLimit: 99, baselineLatencyMs: 100 } })
      expect(h.c.getLimit()).toBe(T.ceil)
    })
  })

  describe('instrumentation', () => {
    it('emits goodput, state, and revalidated ratio on every tick', () => {
      const h = makeController({})
      closeWindow(h, 1200, { revalidatedCount: 3 })
      const tick = h.ticks[0]
      expect(tick.goodputRps).toBeCloseTo(10, 1)
      expect(tick.state).toBe('slow-start')
      expect(tick.revalidatedRatio).toBeCloseTo(0.25, 2)
      expect(tick.limit).toBe(8)
      expect(tick.atMs).toBe(START_AT + 1200)
    })
  })
})

describe('HillClimbController unhappy paths', () => {
  /** Close a window that contained one retryable error (11 successes + 1 error). */
  const errorWindow = (h: Harness, elapsedMs = 1200): number | null => {
    feed(h.c, T.windowCompletions - 1, 100)
    h.c.record('retryable')
    return h.c.maybeTick(h.clock.advance(elapsedMs))
  }

  it('a disconnect walks the limit down to the floor and never below', () => {
    const h = makeController({})
    closeWindow(h, 1200) // healthy: blind double → 8
    expect(errorWindow(h)).toBe(6) // round(8 × 0.7)
    expect(errorWindow(h)).toBe(4)
    expect(errorWindow(h)).toBe(3) // floor
    expect(errorWindow(h)).toBe(null) // clamped — no change, no underflow
    expect(h.c.getLimit()).toBe(T.floor)
    expect(
      reasons(h)
        .slice(1)
        .every((r) => r === 'soft-down')
    ).toBe(true)
  })

  it('recovers after a reconnect: floor → probes → climb back up', () => {
    const h = makeController({})
    closeWindow(h, 1200)
    for (let i = 0; i < 4; i++) errorWindow(h) // disconnect: down to floor 3
    expect(h.c.getLimit()).toBe(T.floor)

    // Reconnect onto a fast, RTT-bound link: goodput ∝ limit (10/s per slot).
    for (let i = 0; i < 40; i++) {
      const limit = h.c.getLimit()
      closeWindow(h, Math.max(1, Math.round(1200 / limit)))
    }
    expect(h.c.getLimit()).toBeGreaterThanOrEqual(10)
    expect(reasons(h)).toContain('probe-up')
    expect(reasons(h)).toContain('up')
  })

  it('congestion while a probe is pending cleans the probe up', () => {
    const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 100 } })
    feed(h.c, T.validateAfterCompletions, 100)
    closeWindow(h, 1200, { count: 4 }) // baseline 10/s at 8
    closeWindow(h, 1200) // plateau → 7, climb-down
    closeWindow(h, 1371) // RTT-bound loss → revert to 8, HOLD
    for (let i = 0; i < T.reprobeAfterWindows; i++) closeWindow(h, 1200)
    expect(h.c.getLimit()).toBe(9) // probing

    const immediate = h.c.record('congested')
    expect(immediate).toBe(5) // round(9 × 0.5), applied now
    expect(h.c.getState()).toBe('hold')

    closeWindow(h, 1200)
    // The abandoned probe must not be evaluated after the hard-down.
    expect(h.ticks.at(-1)?.reason).toBe('hold')
    expect(h.c.getLimit()).toBe(5)
  })

  it('repeated congestion at the floor stays clamped', () => {
    const h = makeController({})
    expect(h.c.record('congested')).toBe(T.floor) // round(4 × 0.5) = 2 → clamp 3
    expect(h.c.record('congested')).toBe(T.floor)
    expect(h.c.getLimit()).toBe(T.floor)
  })

  it('a pure latency spike in HOLD moves nothing (goodput is the only signal)', () => {
    const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 100 } })
    feed(h.c, T.validateAfterCompletions, 100)
    closeWindow(h, 1200, { count: 4 })
    closeWindow(h, 1200)
    closeWindow(h, 1371) // HOLD at 8
    h.ticks.length = 0

    // Latency 50× worse, goodput unchanged: nothing may move.
    for (let i = 0; i < 4; i++) closeWindow(h, 1200, { latencyMs: 5000 })
    expect(h.c.getLimit()).toBe(8)
    expect(h.ticks.every((t) => t.reason === 'hold')).toBe(true)
  })

  it('zero-elapsed windows do not produce NaN or unbounded limits', () => {
    const h = makeController({})
    closeWindow(h, 0)
    closeWindow(h, 0)
    expect(Number.isFinite(h.c.getLimit())).toBe(true)
    expect(h.c.getLimit()).toBeLessThanOrEqual(T.ceil)
    expect(h.ticks.every((t) => Number.isFinite(t.goodputRps ?? 0))).toBe(true)
  })

  it('a corrupt zero baseline cannot trigger a false regime reset', () => {
    const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 0 } })
    feed(h.c, T.validateAfterCompletions, 400)
    // worse needs > max(3×0, 500) = 500ms; better needs baseline − ewma > 200.
    expect(h.c.getLimit()).toBe(8)
    expect(reasons(h)).not.toContain('regime-reset')
  })

  it('errors during validation abandon it without wedging the controller', () => {
    const h = makeController({ profile: { learnedLimit: 16, baselineLatencyMs: 100 } })
    feed(h.c, 4, 100) // validation under way (4 of 8)
    for (let i = 0; i < 8; i++) h.c.record('retryable')
    expect(h.c.maybeTick(h.clock.advance(1200))).toBe(11) // soft-down, validation over

    // These would have failed the regime check — but validation was abandoned.
    feed(h.c, T.validateAfterCompletions, 900)
    expect(reasons(h)).not.toContain('regime-reset')
    expect(h.c.getLimit()).toBe(11)

    // And the controller still ticks normally afterwards.
    closeWindow(h, 1200, { count: 4 })
    expect(h.ticks.at(-1)?.reason).toBe('hold') // clean baseline window
  })

  it('congestion after freeze still applies but poisons no profile', () => {
    const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 100 } })
    feed(h.c, T.validateAfterCompletions, 100)
    closeWindow(h, 1200, { count: 4 })
    closeWindow(h, 1200)
    closeWindow(h, 1371) // HOLD at 8, 36 completions
    h.c.freeze()
    expect(h.c.record('congested')).toBe(4) // the server signal still counts
    expect(h.c.getSettledProfile(5_000_000)).toBeNull()
  })

  it('an all-304 warm-cache run still adapts on revalidation goodput', () => {
    const h = makeController({})
    closeWindow(h, 1200, { revalidatedCount: 12 }) // blind double → 8
    closeWindow(h, 600, { revalidatedCount: 12 }) // same mix → comparable → 2× gain
    expect(h.c.getLimit()).toBe(16)
  })
})

describe('HillClimbController coverage edges', () => {
  it('a success without a latency sample counts toward the window but decides nothing', () => {
    const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 100 } })
    expect(h.c.record('success')).toBe(null)
    // No latency → no EWMA sample → validation must not be consumed by it.
    expect(h.c.getState()).toBe('validating')
  })

  it('HOLD reached through congestion alone never yields a profile (sample-starved)', () => {
    const h = makeController({})
    h.c.record('congested') // forces HOLD with totalCompletions = 1
    expect(h.c.getState()).toBe('hold')
    expect(h.c.getSettledProfile(5_000_000)).toBeNull()
  })

  it('a soft-down before freeze degrades the profile goodput to 0, not the profile itself', () => {
    const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 100 } })
    feed(h.c, T.validateAfterCompletions, 100)
    closeWindow(h, 1200, { count: 4 })
    closeWindow(h, 1200) // plateau → 7
    closeWindow(h, 1371) // revert → HOLD at 8
    feed(h.c, T.windowCompletions - 1, 100)
    h.c.record('retryable')
    h.c.maybeTick(h.clock.advance(1200)) // soft-down clears the goodput baseline
    h.c.freeze()

    const profile = h.c.getSettledProfile(5_000_000)
    expect(profile).not.toBeNull() // soft-downs do not poison the profile…
    expect(profile?.baselineGoodputRps).toBe(0) // …but the goodput reading is gone
  })

  it('a cache-mix shift during a pending probe rejects the probe', () => {
    const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 100 } })
    feed(h.c, T.validateAfterCompletions, 100)
    closeWindow(h, 1200, { count: 4 })
    closeWindow(h, 1200)
    closeWindow(h, 1371) // HOLD at 8
    for (let i = 0; i < T.reprobeAfterWindows; i++) closeWindow(h, 1200)
    expect(h.c.getLimit()).toBe(9) // probing

    closeWindow(h, 1200, { revalidatedCount: 10 }) // 304 share jumps 0 → 0.83
    expect(h.ticks.at(-1)?.reason).toBe('probe-reject')
    expect(h.c.getLimit()).toBe(8)
  })

  it('climb-up ends with a revert to the knee when a +1 stops paying', () => {
    const h = makeController({ profile: { learnedLimit: 8, baselineLatencyMs: 100 } })
    feed(h.c, T.validateAfterCompletions, 100)
    closeWindow(h, 1200, { count: 4 })
    closeWindow(h, 1200)
    closeWindow(h, 1371) // HOLD at 8, best 10/s
    for (let i = 0; i < T.reprobeAfterWindows; i++) closeWindow(h, 1200)
    closeWindow(h, 1000) // probe accepted: 12/s ≥ 1.05× → climb-up, limit 10
    expect(h.c.getState()).toBe('climb-up')
    expect(h.c.getLimit()).toBe(10)

    closeWindow(h, 1000) // 12/s again: gain 1.0 < gainEpsilon → take the +1 back
    expect(h.ticks.at(-1)?.reason).toBe('revert')
    expect(h.c.getLimit()).toBe(9)
    expect(h.c.getState()).toBe('hold')
  })

  it('a flat count-down lands on the floor and holds there', () => {
    const h = makeController({ profile: { learnedLimit: 4, baselineLatencyMs: 100 } })
    feed(h.c, T.validateAfterCompletions, 100)
    closeWindow(h, 1200, { count: 4 }) // baseline at 4
    closeWindow(h, 1200) // plateau → 3 (floor), climb-down
    closeWindow(h, 1200) // still flat at the floor → settle
    expect(h.c.getLimit()).toBe(T.floor)
    expect(h.c.getState()).toBe('hold')

    // Degraded windows at the floor must not push below it.
    h.ticks.length = 0
    closeWindow(h, 1600)
    closeWindow(h, 1600)
    expect(h.c.getLimit()).toBe(T.floor)
    expect(reasons(h)).toEqual(['hold', 'hold'])
  })
})
