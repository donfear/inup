import chalk from 'chalk'
import { describe, expect, it } from 'vitest'
import {
  fitModalSections,
  renderModalFrame,
  renderModalRow,
} from '../../../../src/features/interactive/modal/layout'
import { getVisualLength } from '../../../../src/shared/terminal'

describe('modal layout primitives', () => {
  it('renders centered modal frames', () => {
    const lines = renderModalFrame([{ key: 'header', rows: ['Title'], required: true }], {
      terminalWidth: 80,
      terminalHeight: 20,
      minWidth: 60,
      maxWidth: 60,
    })

    const topBorder = lines.find((line) => line.includes('╭'))!
    expect(topBorder.startsWith('          ')).toBe(true)
  })

  it('trims low-priority sections first when height is constrained', () => {
    const sections = fitModalSections(
      [
        { key: 'header', rows: ['Title'], required: true },
        { key: 'description', rows: ['a', 'b', 'c'] },
        { key: 'homepage', rows: ['link'] },
      ],
      6,
      ['homepage', 'description']
    )

    expect(sections.find((section) => section.key === 'homepage')).toBeUndefined()
    expect(sections.find((section) => section.key === 'description')?.rows).toEqual(['a', 'b'])
  })

  it('measures ANSI and wide characters correctly for modal rows', () => {
    renderModalRow(2, 20, `${chalk.red('abc')}🙂`)
    expect(getVisualLength(`${chalk.red('abc')}🙂`)).toBe(5)
  })

  it('measures emoji presentation (VS16) as wide, text presentation as narrow', () => {
    expect(getVisualLength('ℹ️')).toBe(2)
    // Bare U+26A0 has text presentation: terminals render it one column wide,
    // and string-width agrees (the old heuristic mis-scored it as 2).
    expect(getVisualLength('⚠')).toBe(1)
    expect(getVisualLength('⚠️')).toBe(2)
  })

  it('keeps borders aligned across plain, CJK, emoji, colored, and hyperlink rows', () => {
    const modalWidth = 40
    const padding = 3
    const rows = [
      'plain text',
      '你好世界パッケージ',
      'emoji 🚀 and family 👨‍👩‍👧‍👦',
      `${chalk.red('colored')} ${chalk.bold('bold')}`,
      '\u001b]8;;https://example.com\u0007homepage\u001b]8;;\u0007',
      '',
    ]

    // Every row must render at exactly padding + modalWidth columns, or the
    // right border drifts. This is the invariant the width swap must uphold.
    const widths = rows.map((row) => getVisualLength(renderModalRow(padding, modalWidth, row)))
    expect(widths).toEqual(rows.map(() => padding + modalWidth))
  })

  it('renders every frame line at the same visual width with mixed content', () => {
    const lines = renderModalFrame(
      [
        { key: 'header', rows: ['📦 test-pkg'], required: true },
        { key: 'description', rows: ['一个用于升级依赖的交互式命令行工具'] },
      ],
      { terminalWidth: 80, terminalHeight: 20, minWidth: 60, maxWidth: 60 }
    )

    const widths = lines.filter((line) => line !== '').map((line) => getVisualLength(line))
    expect(new Set(widths).size).toBe(1)
  })
})
