import { describe, expect, it } from 'vitest'
import { renderHelpModal } from '../../../../../src/features/interactive/renderer/help-modal'
import { getHelpGroups } from '../../../../../src/features/interactive/keymap'
import { stripAnsi } from '../../../../../src/shared/terminal/text'

const plain = (lines: string[]) => lines.map(stripAnsi).join('\n')

describe('renderHelpModal', () => {
  it('renders the title and every keymap group with its bindings', () => {
    const text = plain(renderHelpModal(100, 60).lines)

    expect(text).toContain('Keyboard Shortcuts')
    for (const { group, bindings } of getHelpGroups()) {
      expect(text).toContain(group)
      for (const binding of bindings) {
        expect(text).toContain(binding.help)
      }
    }
  })

  it('reports one content row per binding plus group headers and separators', () => {
    const groups = getHelpGroups()
    const expectedRows =
      groups.reduce((sum, { bindings }) => sum + 1 + bindings.length, 0) + groups.length - 1

    const result = renderHelpModal(100, 60)

    expect(result.totalContentRows).toBe(expectedRows)
  })

  it('does not scroll on tall terminals', () => {
    const result = renderHelpModal(100, 60)

    expect(result.usesInternalScroll).toBe(false)
    expect(result.maxScrollOffset).toBe(0)
    expect(plain(result.lines)).not.toContain('Lines ')
  })

  it('scrolls with a range footer on short terminals', () => {
    const result = renderHelpModal(100, 12, 0)

    expect(result.usesInternalScroll).toBe(true)
    expect(result.maxScrollOffset).toBeGreaterThan(0)
    expect(plain(result.lines)).toMatch(/Lines 1-\d+ of \d+/)
  })

  it('clamps the scroll offset to the maximum', () => {
    const atMax = renderHelpModal(100, 12, 999)
    const exact = renderHelpModal(100, 12, atMax.maxScrollOffset)

    expect(atMax.lines).toEqual(exact.lines)
    expect(plain(atMax.lines)).toContain(
      `Lines ${atMax.maxScrollOffset + 1}-${atMax.totalContentRows} of ${atMax.totalContentRows}`
    )
  })

  it('respects the 54-76 column width bounds', () => {
    const narrow = stripAnsi(renderHelpModal(60, 30).lines.find((line) => line.includes('╭'))!)
    const wide = stripAnsi(renderHelpModal(200, 30).lines.find((line) => line.includes('╭'))!)

    expect(narrow.trimStart()).toHaveLength(54)
    expect(wide.trimStart()).toHaveLength(76)
  })
})
