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
    expect(stripAnsi('\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007')).toBe('link')
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
  it('counts CJK characters as two terminal columns', () => {
    // The old hand-rolled version had no East Asian Width tables and scored
    // these as width 1, misaligning every column containing CJK text.
    expect(getVisualLength('你好')).toBe(4)
    expect(getVisualLength('パッケージ')).toBe(10)
    expect(getVisualLength('한국어')).toBe(6)
  })

  it('measures complex grapheme clusters as single wide glyphs', () => {
    expect(getVisualLength('👨‍👩‍👧‍👦')).toBe(2) // ZWJ family sequence
    expect(getVisualLength('👍🏽')).toBe(2) // skin-tone modifier
    expect(getVisualLength('🇺🇸')).toBe(2) // regional-indicator flag
  })

  it('measures OSC-8 hyperlinks by their visible label only', () => {
    // The modal linkifies mentions/PRs/commits into OSC-8 hyperlinks; layout
    // math must see only the label, or every linked row would be misaligned.
    const hyperlink = '\u001b]8;;https://example.com\u0007docs\u001b]8;;\u0007'
    expect(getVisualLength(hyperlink)).toBe(4)
    expect(stripAnsi(hyperlink)).toBe('docs')
  })

  it('returns zero for empty and ANSI-only strings', () => {
    expect(getVisualLength('')).toBe(0)
    expect(getVisualLength('\u001b[31m\u001b[39m')).toBe(0)
  })

  it('measures colored CJK/emoji mixes by visible content', () => {
    expect(getVisualLength('\u001b[31m你好\u001b[39m 🚀 ok')).toBe(10)
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

  it('truncates by visual width, not code units', () => {
    // Four CJK chars are 8 columns; a 7-column budget keeps two of them
    // (4 columns) plus the 3-column ellipsis. The old version sliced by code
    // units and could overflow the column.
    expect(truncatePlainText('你好世界', 7)).toBe('你好...')
  })

  it('drops a wide char that cannot fit rather than overflow an odd budget', () => {
    // At width 6 a second wide char plus the ellipsis would need 7 columns,
    // so only one CJK char survives (total width 5 ≤ 6).
    expect(truncatePlainText('你好世界', 6)).toBe('你...')
  })

  it('never exceeds the width budget for any input', () => {
    const inputs = [
      'hello world',
      '你好世界啊',
      'パッケージ管理ツール',
      'emoji 🚀🚀🚀 tail',
      'ab 👨‍👩‍👧‍👦 cd',
      'mixed 你好 text 🚀',
    ]
    for (const input of inputs) {
      for (let width = 1; width <= 12; width++) {
        const result = truncatePlainText(input, width)
        expect(getVisualLength(result)).toBeLessThanOrEqual(width)
      }
    }
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

  it('wraps CJK text by visual width', () => {
    // Each pair is 4 columns wide, so a 4-column budget fits exactly one pair
    // per line. The old width-1-per-char math would have packed two.
    expect(wrapPlainText('你好 世界 你好', 4)).toEqual(['你好', '世界', '你好'])
  })

  it('re-balances ANSI color codes across wrapped lines', () => {
    // The old implementation wrapped ANSI-blind: an opened color bled across
    // the line break and the padding after it.
    const lines = wrapPlainText('\u001b[31mone two three four\u001b[39m', 8)

    expect(lines.map(stripAnsi)).toEqual(['one two', 'three', 'four'])
    for (const line of lines) {
      expect(line).toContain('\u001b[31m') // color re-opened on every line
      expect(line).toContain('\u001b[39m') // and closed before the break
      expect(getVisualLength(line)).toBeLessThanOrEqual(8)
    }
  })

  it('keeps every wrapped line within the width budget for any input', () => {
    const inputs = [
      'plain words to wrap around',
      '你好 世界 你好 世界',
      'emoji 🚀 rocket 🚀 tail',
      'a 👨‍👩‍👧‍👦 b 👨‍👩‍👧‍👦 c',
      'パッケージ 管理 ツール',
    ]
    for (const input of inputs) {
      for (let width = 4; width <= 12; width++) {
        for (const line of wrapPlainText(input, width)) {
          // Overflow is only permitted for a single unbreakable word.
          if (getVisualLength(line) > width) {
            expect(line).not.toContain(' ')
          }
        }
      }
    }
  })
})
