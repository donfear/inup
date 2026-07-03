import { describe, expect, it } from 'vitest'
import { UIRenderer } from '../../../../../src/features/interactive/renderer'
import { stripAnsi } from '../../../../../src/shared/terminal/text'
import { makeSelectionState } from '../../../../fixtures/selection-state-factory'

const renderer = new UIRenderer()

describe('UIRenderer', () => {
  it('renders section headers with their title', () => {
    for (const sectionType of ['main', 'peer', 'optional'] as const) {
      expect(stripAnsi(renderer.renderSectionHeader('Dependencies', sectionType))).toContain(
        'Dependencies'
      )
    }
  })

  it('renders a spacer line', () => {
    expect(typeof renderer.renderSpacer()).toBe('string')
  })

  it('renders the package list interface', () => {
    const lines = renderer.renderInterface([makeSelectionState()], 0, 0, 10, false)

    expect(lines.length).toBeGreaterThan(0)
    expect(lines.map(stripAnsi).join('\n')).toContain('test-pkg')
  })

  it('renders the packages table for empty, current, and outdated inputs', () => {
    expect(stripAnsi(renderer.renderPackagesTable([]))).toContain('All packages are up to date!')
    expect(stripAnsi(renderer.renderPackagesTable([{ isOutdated: false }]))).toContain(
      'All packages are up to date!'
    )
    expect(stripAnsi(renderer.renderPackagesTable([{ isOutdated: true }]))).toContain('inup')
  })

  it('renders the confirmation screen', () => {
    expect(stripAnsi(renderer.renderConfirmation([]))).toContain('No packages selected')
  })

  it('renders the package info loading modal', () => {
    const result = renderer.renderPackageInfoLoading(makeSelectionState(), 100, 30)

    expect(result.lines.length).toBeGreaterThan(0)
    expect(result.lines.map(stripAnsi).join('\n')).toContain('test-pkg')
  })

  it('renders the package info modal', () => {
    const result = renderer.renderPackageInfoModal(makeSelectionState(), 100, 30, 0, 'info')

    expect(result.lines.length).toBeGreaterThan(0)
    expect(result.lines.map(stripAnsi).join('\n')).toContain('test-pkg')
  })

  it('renders the theme selector modal with the preview marked', () => {
    const lines = renderer.renderThemeSelectorModal('dracula', 'monokai', 100, 30)
    const text = lines.map(stripAnsi).join('\n')

    expect(text).toContain('Dracula')
    expect(text).toContain('Monokai')
  })
})
