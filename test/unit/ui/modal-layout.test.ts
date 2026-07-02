import chalk from 'chalk'
import { describe, expect, it } from 'vitest'
import { fitModalSections, renderModalFrame, renderModalRow } from '../../../src/ui/modal/layout'
import { getVisualLength } from '../../../src/shared/terminal'

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

  it('treats emoji variation selectors as zero-width', () => {
    expect(getVisualLength('ℹ️')).toBe(2)
    expect(getVisualLength('⚠')).toBe(2)
  })
})
