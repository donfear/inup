import { describe, expect, it } from 'vitest'
import {
  getVisualLength,
  stripAnsi,
  truncatePlainText,
  wrapPlainText,
} from '../../../../src/shared/terminal/text'

describe('stripAnsi', () => {
  it('removes color escape sequences', () => {
    expect(stripAnsi('\u001b[31mred\u001b[39m')).toBe('red')
  })

  it('removes OSC-8 hyperlink wrappers', () => {
    expect(stripAnsi('\u001b]8;;https://example.comlink\u001b]8;;')).toBe('link')
  })

  it('leaves plain text untouched', () => {
    expect(stripAnsi('plain')).toBe('plain')
  })
})

describe('getVisualLength', () => {
  it('counts plain characters', () => {
    expect(getVisualLength('hello')).toBe(5)
  })

  it('ignores ANSI escape sequences', () => {
    expect(getVisualLength('\u001b[31mhello\u001b[39m')).toBe(5)
  })

  it('counts emoji as two terminal columns', () => {
    // '❤️' is U+2764 followed by variation selector U+FE0F
    expect(getVisualLength('❤️')).toBe(2)
    expect(getVisualLength('🚀')).toBe(2)
  })

  it('skips combining marks', () => {
    // 'e' followed by combining acute accent U+0301... use U+0300 (grave) which
    // is inside the skipped combining range.
    expect(getVisualLength('è')).toBe(1)
  })
})

describe('truncatePlainText', () => {
  it('returns an empty string for a non-positive width', () => {
    expect(truncatePlainText('hello', 0)).toBe('')
    expect(truncatePlainText('hello', -1)).toBe('')
  })

  it('returns short text unchanged', () => {
    expect(truncatePlainText('hello', 5)).toBe('hello')
  })

  it('degrades to dots when the width cannot fit an ellipsis', () => {
    expect(truncatePlainText('hello', 3)).toBe('...')
    expect(truncatePlainText('hello', 2)).toBe('..')
  })

  it('truncates with a three-dot ellipsis', () => {
    expect(truncatePlainText('hello world', 8)).toBe('hello...')
  })
})

describe('wrapPlainText', () => {
  it('returns no lines for empty text', () => {
    expect(wrapPlainText('', 10)).toEqual([])
  })

  it('returns a single line when the text fits or the width is non-positive', () => {
    expect(wrapPlainText('short', 10)).toEqual(['short'])
    expect(wrapPlainText('anything at all', 0)).toEqual(['anything at all'])
  })

  it('wraps on word boundaries', () => {
    expect(wrapPlainText('the quick brown fox', 9)).toEqual(['the quick', 'brown fox'])
  })

  it('puts an overlong word on its own line', () => {
    expect(wrapPlainText('a extraordinarily b', 6)).toEqual(['a', 'extraordinarily', 'b'])
  })
})
