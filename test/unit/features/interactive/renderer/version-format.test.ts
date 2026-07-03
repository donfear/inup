import { describe, expect, it } from 'vitest'
import {
  formatVersionDiff,
  truncateMiddle,
  VersionUtils,
} from '../../../../../src/features/interactive/renderer/version-format'
import { stripAnsi } from '../../../../../src/shared/terminal/text'

// Wraps every segment the diff highlighter colors, so assertions are
// independent of whether chalk emits ANSI codes in this environment.
const marker = (text: string) => `[${text}]`

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

describe('formatVersionDiff', () => {
  it('renders identical versions without highlighting', () => {
    expect(stripAnsi(formatVersionDiff('1.2.3', '1.2.3', marker))).toBe('1.2.3')
  })

  it('treats missing segments as zero and skips highlighting equal versions', () => {
    expect(stripAnsi(formatVersionDiff('1.0', '1.0.0', marker))).toBe('1.0.0')
  })

  it('highlights everything from a major bump onward', () => {
    expect(stripAnsi(formatVersionDiff('1.2.3', '2.0.0', marker))).toBe('[2][.][0][.][0]')
  })

  it('keeps the major segment plain on a minor bump', () => {
    expect(stripAnsi(formatVersionDiff('1.2.3', '1.3.0', marker))).toBe('1[.][3][.][0]')
  })

  it('keeps major and minor plain on a patch bump', () => {
    expect(stripAnsi(formatVersionDiff('1.2.3', '1.2.4', marker))).toBe('1.2[.][4]')
  })

  it('pads a shorter current version with zeros', () => {
    expect(stripAnsi(formatVersionDiff('1.2', '1.2.3', marker))).toBe('1.2[.][3]')
  })

  it('pads a shorter target version with zeros', () => {
    expect(stripAnsi(formatVersionDiff('1.2.3', '1.2', marker))).toBe('1.2[.][0]')
  })

  it('coerces non-numeric segments to zero', () => {
    expect(stripAnsi(formatVersionDiff('x', '1', marker))).toBe('[1]')
  })
})

describe('VersionUtils', () => {
  it('bundles the formatting helpers', () => {
    expect(VersionUtils.truncateMiddle).toBe(truncateMiddle)
    expect(VersionUtils.formatVersionDiff).toBe(formatVersionDiff)
    expect(VersionUtils.getVisualLength('\u001b[31mab\u001b[39m')).toBe(2)
    expect(VersionUtils.stripAnsi('\u001b[31mab\u001b[39m')).toBe('ab')
    expect(VersionUtils.applyVersionPrefix('^1.0.0', '2.0.0')).toBe('^2.0.0')
  })
})
