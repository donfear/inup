import { describe, expect, it } from 'vitest'
import { formatAge } from '../../../src/shared/duration'

describe('formatAge', () => {
  it('reports sub-hour ages in minutes', () => {
    expect(formatAge(0)).toBe('0m')
    expect(formatAge(45)).toBe('45m')
    expect(formatAge(59)).toBe('59m')
  })

  it('switches to hours at exactly one hour', () => {
    expect(formatAge(60)).toBe('1h')
    expect(formatAge(150)).toBe('2h')
    expect(formatAge(60 * 24 - 1)).toBe('23h')
  })

  it('switches to days at exactly one day', () => {
    expect(formatAge(60 * 24)).toBe('1d')
    expect(formatAge(60 * 24 * 42)).toBe('42d')
  })
})
