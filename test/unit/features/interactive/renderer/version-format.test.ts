import { describe, expect, it } from 'vitest'
import {
  truncateMiddle,
  VersionUtils,
} from '../../../../../src/features/interactive/renderer/version-format'

describe('truncateMiddle', () => {
  it('returns short strings unchanged', () => {
    expect(truncateMiddle('short', 10)).toBe('short')
    expect(truncateMiddle('exactly-10', 10)).toBe('exactly-10')
  })

  it('replaces the middle with an ellipsis, keeping more of the start on odd budgets', () => {
    // maxLength 8 → 7 visible chars: 4 from the start, 3 from the end
    expect(truncateMiddle('abcdefghijkl', 8)).toBe('abcd…jkl')
  })

  it('splits evenly when the remaining budget is even', () => {
    // maxLength 9 → 8 visible chars: 4 + 4
    expect(truncateMiddle('abcdefghijkl', 9)).toBe('abcd…ijkl')
  })

  it('measures ANSI-colored input by visual length and truncates the plain text', () => {
    const colored = '\u001b[31mabcdefghijkl\u001b[39m'

    expect(truncateMiddle(colored, 9)).toBe('abcd…ijkl')
  })

  it('preserves ANSI codes when no truncation is needed', () => {
    const colored = '\u001b[31mabc\u001b[39m'

    expect(truncateMiddle(colored, 5)).toBe(colored)
  })
})

describe('VersionUtils', () => {
  it('bundles the formatting helpers', () => {
    expect(VersionUtils.truncateMiddle).toBe(truncateMiddle)
    expect(VersionUtils.getVisualLength('\u001b[31mab\u001b[39m')).toBe(2)
    expect(VersionUtils.stripAnsi('\u001b[31mab\u001b[39m')).toBe('ab')
    expect(VersionUtils.applyVersionPrefix('^1.0.0', '2.0.0')).toBe('^2.0.0')
  })
})
