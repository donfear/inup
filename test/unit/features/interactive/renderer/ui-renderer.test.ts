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

  it('announces cooldown-held packages in the header, with and without a package manager', () => {
    // Fully-held packages never enter the list, so the header is the only place
    // the run can admit that a newer version exists and was withheld.
    const pmInfo = {
      name: 'pnpm',
      displayName: 'pnpm',
      lockFile: 'pnpm-lock.yaml',
      workspaceFile: null,
      installCommand: 'pnpm install',
      color: null,
    } as any

    const withPm = renderer.renderInterface(
      [makeSelectionState()],
      0,
      0,
      10,
      false,
      undefined,
      undefined,
      pmInfo,
      undefined,
      undefined,
      undefined,
      120,
      undefined,
      undefined,
      { cooldown: { heldCount: 3, unsupported: false } }
    )
    expect(stripAnsi(withPm.join('\n'))).toContain('3 held by cooldown')

    const withoutPm = renderer.renderInterface(
      [makeSelectionState()],
      0,
      0,
      10,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      120,
      undefined,
      undefined,
      { cooldown: { heldCount: 2, unsupported: false } }
    )
    expect(stripAnsi(withoutPm.join('\n'))).toContain('2 held by cooldown')
  })

  it('says so in the header when the cooldown could not act at all', () => {
    // Fails open on missing publish times, so an inert cooldown otherwise looks
    // exactly like a satisfied one.
    const lines = renderer.renderInterface(
      [makeSelectionState()],
      0,
      0,
      10,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      140,
      undefined,
      undefined,
      { cooldown: { heldCount: 0, unsupported: true } }
    )
    expect(stripAnsi(lines.join('\n'))).toContain(
      'cooldown inactive: registry has no publish times'
    )
  })

  it('prefers the inactive warning over a held count', () => {
    const lines = renderer.renderInterface(
      [makeSelectionState()],
      0,
      0,
      10,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      140,
      undefined,
      undefined,
      { cooldown: { heldCount: 3, unsupported: true } }
    )
    const text = stripAnsi(lines.join('\n'))
    expect(text).toContain('cooldown inactive')
    expect(text).not.toContain('3 held by cooldown')
  })

  it('omits the cooldown header note when nothing is held', () => {
    const lines = renderer.renderInterface([makeSelectionState()], 0, 0, 10, false)
    expect(stripAnsi(lines.join('\n'))).not.toContain('held by cooldown')
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
