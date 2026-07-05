import { describe, expect, it } from 'vitest'
import {
  findBinding,
  getFooterHints,
  getHelpGroups,
  KEY_BINDINGS,
  KEY_GROUPS,
  renderReadmeKeyTable,
} from '../../../../src/features/interactive/keymap'

describe('keymap', () => {
  it('has no duplicate key tokens', () => {
    const seen = new Set<string>()
    for (const binding of KEY_BINDINGS) {
      for (const token of binding.tokens ?? []) {
        expect(seen.has(token), `duplicate token: ${token}`).toBe(false)
        seen.add(token)
      }
    }
  })

  it('every binding has help text, display keys, and a known group', () => {
    for (const binding of KEY_BINDINGS) {
      expect(binding.help.length).toBeGreaterThan(0)
      expect(binding.displayKeys.length).toBeGreaterThan(0)
      expect(KEY_GROUPS).toContain(binding.group)
    }
  })

  it('resolves the case-sensitive g/G pair distinctly', () => {
    expect(findBinding('g')?.action).toEqual({ type: 'navigate_top' })
    expect(findBinding('G')?.action).toEqual({ type: 'navigate_bottom' })
  })

  it('falls back to the lowercase letter for shifted keys', () => {
    expect(findBinding('M')?.action).toEqual({ type: 'bulk_select_minor' })
    expect(findBinding('V')?.action).toEqual({ type: 'toggle_vulnerable_filter' })
  })

  it('returns undefined for unmapped keys', () => {
    expect(findBinding('z')).toBeUndefined()
  })

  it('exposes curated footer hints (Space and vulnerable filter live in the overlay)', () => {
    const labels = getFooterHints().map((hint) => hint.label)
    expect(labels).toContain('Move')
    expect(labels).toContain('Help')
    expect(labels).not.toContain('Toggle')
  })

  it('covers every binding exactly once across help groups', () => {
    const grouped = getHelpGroups().flatMap((entry) => entry.bindings)
    expect(grouped).toHaveLength(KEY_BINDINGS.length)
  })

  it('renders a markdown table row for every binding', () => {
    const table = renderReadmeKeyTable()
    expect(table.startsWith('| Key | Action |')).toBe(true)
    for (const binding of KEY_BINDINGS) {
      expect(table).toContain(`| \`${binding.displayKeys}\` | ${binding.help} |`)
    }
  })
})
