import { describe, it, expect, vi } from 'vitest'
import {
  AdaptiveController,
  ControlTick,
  DEFAULT_TUNING,
} from '../../../../src/shared/http/adaptive-controller'

// Small, explicit tuning so the math in assertions is obvious.
const tuning = {
  floor: 3,
  ceil: 24,
  increaseStep: 2,
  softDecreaseFactor: 0.7,
  hardDecreaseFactor: 0.5,
  ewmaAlpha: 0.5,
  ticksEveryCompletions: 4,
}

const drive = (
  c: AdaptiveController,
  kind: Parameters<AdaptiveController['record']>[0],
  latencyMs?: number
) => {
  const immediate = c.record(kind, latencyMs)
  const ticked = c.maybeTick()
  return { immediate, ticked }
}

describe('AdaptiveController', () => {
  describe('shouldControl', () => {
    it('skips control at or below the ceiling', () => {
      expect(AdaptiveController.shouldControl(24)).toBe(false)
      expect(AdaptiveController.shouldControl(10)).toBe(false)
      expect(AdaptiveController.shouldControl(25)).toBe(true)
    })
  })

  describe('smart start', () => {
    it('starts near the work size, clamped to [floor, ceil]', () => {
      expect(new AdaptiveController(50, undefined, tuning).getLimit()).toBe(24) // ceil
      expect(new AdaptiveController(2, undefined, tuning).getLimit()).toBe(3) // floor
      expect(new AdaptiveController(10, undefined, tuning).getLimit()).toBe(10)
    })

    it('ramps up additively from a low smart start toward the ceiling', () => {
      // A run whose work size is below the ceiling starts there and ramps up.
      const c = new AdaptiveController(5, undefined, tuning)
      expect(c.getLimit()).toBe(5)
      for (let i = 0; i < tuning.ticksEveryCompletions - 1; i++) c.record('success', 50)
      const { ticked } = drive(c, 'success', 50)
      expect(ticked).toBe(5 + tuning.increaseStep) // ramps up from the low start
    })
  })

  it('additively increases when healthy (no retries, stable latency)', () => {
    const c = new AdaptiveController(10, undefined, tuning)
    const start = c.getLimit() // 10
    // 4 stable successes → one healthy tick → +2
    for (let i = 0; i < 3; i++) c.record('success', 100)
    const { ticked } = drive(c, 'success', 100)
    expect(ticked).toBe(start + 2)
  })

  it('soft-decreases on retries within a tick window', () => {
    const c = new AdaptiveController(10, undefined, tuning)
    c.record('success', 100)
    c.record('success', 100)
    c.record('retryable')
    const { ticked } = drive(c, 'success', 100)
    // limit 10 * 0.7 = 7
    expect(ticked).toBe(7)
  })

  it('does NOT back off on rising latency alone (latency is noise, not a signal)', () => {
    const c = new AdaptiveController(10, undefined, tuning)
    // Establish a low EWMA.
    c.record('success', 100)
    c.record('success', 100)
    c.record('success', 100)
    drive(c, 'success', 100) // healthy tick → 12

    // Now feed dramatically higher latency, but with NO errors. The controller
    // must keep ramping — latency variance on a healthy link is not congestion.
    c.record('success', 1000)
    c.record('success', 1000)
    c.record('success', 1000)
    const { ticked } = drive(c, 'success', 1000)
    expect(ticked).toBe(14) // 12 + 2, still ramping despite the latency spike
  })

  it('hard-decreases immediately on congestion (429/503), independent of ticks', () => {
    const c = new AdaptiveController(20, undefined, tuning)
    const start = c.getLimit() // 20
    const immediate = c.record('congested')
    // 20 * 0.5 = 10, applied immediately (not waiting for a tick)
    expect(immediate).toBe(10)
    expect(c.getLimit()).toBe(10)
  })

  it('clamps to floor and ceil', () => {
    const cHi = new AdaptiveController(50, undefined, tuning) // starts at ceil 24
    for (let i = 0; i < 3; i++) cHi.record('success', 50)
    const { ticked } = drive(cHi, 'success', 50)
    expect(ticked ?? cHi.getLimit()).toBe(24) // cannot exceed ceil

    const cLo = new AdaptiveController(4, undefined, tuning) // starts at 4
    // Repeated congestion drives toward floor and stops there.
    cLo.record('congested') // 4*0.5=2 → clamp floor 3
    expect(cLo.getLimit()).toBe(3)
    cLo.record('congested') // 3*0.5=1.5→round 2 → clamp floor 3
    expect(cLo.getLimit()).toBe(3)
  })

  it('does NOT fold retry-backoff sleeps into latency (only success samples count)', () => {
    const ticks: ControlTick[] = []
    const c = new AdaptiveController(10, (t) => ticks.push(t), tuning)
    // A run that succeeds at low latency, with a retryable error mixed in.
    // The retryable error must not contribute a latency sample, only a retry count.
    c.record('success', 100)
    c.record('retryable') // no latency arg — must not move EWMA
    c.record('success', 100)
    drive(c, 'success', 100)
    const tick = ticks[ticks.length - 1]
    // EWMA reflects only the 100ms successes, not any inflated retry timing.
    expect(tick.ewmaMs).toBe(100)
    // And the retry forced a soft-down rather than an increase.
    expect(tick.reason).toBe('soft-down')
  })

  it('emits control ticks for instrumentation', () => {
    const onTick = vi.fn()
    const c = new AdaptiveController(10, onTick, tuning)
    for (let i = 0; i < 3; i++) c.record('success', 100)
    c.record('success', 100)
    c.maybeTick()
    expect(onTick).toHaveBeenCalledTimes(1)
    const tick = onTick.mock.calls[0][0] as ControlTick
    expect(tick.reason).toBe('up')
    expect(tick.limit).toBe(12)
  })

  it('default tuning matches the pool ceiling', () => {
    expect(DEFAULT_TUNING.ceil).toBe(24)
    expect(DEFAULT_TUNING.floor).toBe(6)
  })
})
