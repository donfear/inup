import { describe, expect, it } from 'vitest'
import { clamp, Ewma, round2, roundTo } from '../../../src/shared/math'

describe('clamp', () => {
  it('returns the value when it is inside the range', () => {
    expect(clamp(5, 1, 10)).toBe(5)
  })

  it('clamps below to the lower bound and above to the upper bound', () => {
    expect(clamp(-3, 1, 10)).toBe(1)
    expect(clamp(42, 1, 10)).toBe(10)
  })

  it('collapses to the single point when lo === hi', () => {
    expect(clamp(7, 4, 4)).toBe(4)
  })
})

describe('roundTo / round2', () => {
  it('rounds to the requested number of decimal places', () => {
    expect(roundTo(1.23456, 3)).toBe(1.235)
    expect(roundTo(1.5, 0)).toBe(2)
  })

  it('round2 rounds to two decimal places', () => {
    expect(round2(1.98765)).toBe(1.99)
    expect(round2(2.567)).toBe(2.57)
  })
})

describe('Ewma', () => {
  it('is zero-valued with zero samples before the first update', () => {
    const ewma = new Ewma(0.3)
    expect(ewma.value).toBe(0)
    expect(ewma.count).toBe(0)
  })

  it('seeds from the first sample instead of averaging against zero', () => {
    const ewma = new Ewma(0.3)
    ewma.update(100)
    expect(ewma.value).toBe(100)
    expect(ewma.count).toBe(1)
  })

  it('blends later samples with the configured alpha', () => {
    const ewma = new Ewma(0.3)
    ewma.update(100)
    ewma.update(200)
    // 0.3 * 200 + 0.7 * 100
    expect(ewma.value).toBeCloseTo(130)
    expect(ewma.count).toBe(2)
  })
})
