import { describe, it, expect } from 'vitest'
import { normalizeDeprecatedMessage, extractEnginesNode } from '../../../src/utils/manifest'

describe('normalizeDeprecatedMessage', () => {
  it('returns the message for a string deprecation', () => {
    expect(normalizeDeprecatedMessage('no longer maintained')).toBe('no longer maintained')
  })

  it('normalizes boolean-true into a generic message', () => {
    expect(normalizeDeprecatedMessage(true)).toBe('This version is deprecated.')
  })

  it('returns undefined for non-deprecated inputs', () => {
    expect(normalizeDeprecatedMessage(undefined)).toBeUndefined()
    expect(normalizeDeprecatedMessage(false)).toBeUndefined()
    expect(normalizeDeprecatedMessage('')).toBeUndefined()
    expect(normalizeDeprecatedMessage('   ')).toBeUndefined()
  })
})

describe('extractEnginesNode', () => {
  it('extracts a node range', () => {
    expect(extractEnginesNode({ node: '>=22' })).toBe('>=22')
  })

  it('returns undefined when node is absent or not a string', () => {
    expect(extractEnginesNode({})).toBeUndefined()
    expect(extractEnginesNode({ node: 22 })).toBeUndefined()
    expect(extractEnginesNode({ npm: '>=8' })).toBeUndefined()
    expect(extractEnginesNode(undefined)).toBeUndefined()
    expect(extractEnginesNode(null)).toBeUndefined()
  })
})
