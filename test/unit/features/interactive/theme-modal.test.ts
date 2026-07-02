import { describe, expect, it } from 'vitest'
import { renderThemeSelectorModal } from '../../../../src/features/interactive/modal/theme-selector'

describe('theme selector modal renderer', () => {
  it('uses the shared modal frame and shows theme instructions', () => {
    const lines = renderThemeSelectorModal('default', 'default', 100, 24)
    const rendered = lines.join('\n')

    expect(rendered).toContain('Select Theme')
    expect(rendered).toContain('Enter to confirm')
    expect(rendered).toContain('╭')
    expect(rendered).toContain('╰')
  })
})
