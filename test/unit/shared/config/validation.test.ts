import { describe, expect, it } from 'vitest'
import {
  isValidConcurrency,
  isValidMinimumReleaseAge,
  POOL_CONNECTIONS,
} from '../../../../src/shared/config'

describe('isValidConcurrency', () => {
  it.each([1, 4, POOL_CONNECTIONS])('accepts %o', (value) => {
    expect(isValidConcurrency(value)).toBe(true)
  })

  it.each([0, -1, POOL_CONNECTIONS + 1, 2.5, Number.NaN, '4', null, undefined])(
    'rejects %o',
    (value) => {
      expect(isValidConcurrency(value)).toBe(false)
    }
  )
})

describe('isValidMinimumReleaseAge', () => {
  it.each([0, 1, 10080])('accepts %o', (value) => {
    expect(isValidMinimumReleaseAge(value)).toBe(true)
  })

  it.each([-1, 7.5, Number.NaN, Number.POSITIVE_INFINITY, '10080', null, undefined])(
    'rejects %o',
    (value) => {
      expect(isValidMinimumReleaseAge(value)).toBe(false)
    }
  )
})
