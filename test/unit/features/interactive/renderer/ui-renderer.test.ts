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
    expect(stripAnsi(withPm.join('\n'))).toContain('3 fully held by cooldown')

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
    expect(stripAnsi(withoutPm.join('\n'))).toContain('2 fully held by cooldown')
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
    expect(text).not.toContain('3 fully held by cooldown')
  })

  it('names the key that reveals the held packages, and drops the count once they are shown', () => {
    // A count nobody can act on is worse than no count, so the header points at the way to
    // see them. Once they are on screen it goes away entirely: it counts unique package
    // names while the list counts rows, and two nearly-equal numbers side by side read as
    // a bug rather than as two different questions.
    const hidden = renderer.renderInterface(
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
      { cooldown: { heldCount: 5, unsupported: false } }
    )
    expect(stripAnsi(hidden.join('\n'))).toContain('5 fully held by cooldown, not listed — press c')

    const shown = renderer.renderInterface(
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
      { cooldown: { heldCount: 5, unsupported: false }, cooldownHeldShown: true }
    )
    expect(stripAnsi(shown.join('\n'))).not.toContain('held by cooldown')
  })

  it('marks a held-only row with [HELD] and leaves the version columns to real upgrades', () => {
    // The badge signals, `i` explains — the same contract `[DEPR]` and `[ENG]` have. Putting
    // the withheld version in the latest column would offer, in the column that means "pick
    // one of these", a version that was deliberately refused.
    const held = makeSelectionState({
      name: 'zod',
      currentVersionSpecifier: '^4.1.12',
      latestVersion: '4.1.12',
      hasRangeUpdate: false,
      hasMajorUpdate: false,
      heldOnly: true,
      heldByCooldown: {
        version: '4.1.13',
        publishedAt: '2026-09-17T00:00:00.000Z',
        ageMinutes: 2880,
        count: 1,
      },
    })

    const text = stripAnsi(
      renderer
        .renderInterface(
          [held],
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
          140
        )
        .join('\n')
    )

    expect(text).toContain('zod')
    expect(text).toContain('[HELD]')
    expect(text).not.toContain('4.1.13')
  })

  it('keeps a real upgrade in the latest column even when that row also has a hold', () => {
    // A partially-held row has BOTH: something you can take, and something newer that was
    // withheld. The column shows what you can act on; the hold is on the badge and in the
    // modal. Showing the withheld version here would offer a version that was refused.
    const partiallyHeld = makeSelectionState({
      name: 'baseline-browser-mapping',
      currentVersionSpecifier: '^2.11.22',
      latestVersion: '2.11.24',
      hasMajorUpdate: true,
      heldByCooldown: {
        version: '2.11.25',
        publishedAt: '2026-09-17T23:00:00.000Z',
        ageMinutes: 780,
        count: 1,
      },
    })

    const text = stripAnsi(
      renderer
        .renderInterface(
          [partiallyHeld],
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
          140
        )
        .join('\n')
    )

    expect(text).toContain('[HELD]')
    expect(text).toContain('^2.11.24')
    expect(text).not.toContain('2.11.25')
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
