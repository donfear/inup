import { describe, expect, it } from 'vitest'
import {
  renderInterface,
  renderPackageLine,
  renderPackagesTable,
  renderSectionHeader,
  renderSpacer,
} from '../../../../src/features/interactive/renderer/package-list'
import { VersionUtils } from '../../../../src/features/interactive/renderer/version-format'
import { stripAnsi } from '../../../../src/shared/terminal/text'
import type { PackageManagerInfo, RenderableItem } from '../../../../src/shared/types'
import { makeSelectionState } from '../../../fixtures/selection-state-factory'

const baseState = makeSelectionState({ name: 'demo-pkg' })

const npmInfo: PackageManagerInfo = {
  name: 'npm',
  displayName: 'npm',
  lockFile: 'package-lock.json',
  workspaceFile: null,
  installCommand: 'npm install',
}

interface RenderOptions {
  currentRow?: number
  scrollOffset?: number
  maxVisibleItems?: number
  renderableItems?: RenderableItem[]
  activeFilterLabel?: string
  packageManager?: PackageManagerInfo
  filterMode?: boolean
  filterQuery?: string
  totalPackagesBeforeFilter?: number
  loadingProgress?: Parameters<typeof renderInterface>[12]
  auditProgress?: Parameters<typeof renderInterface>[13]
  notice?: string | null
}

function renderPlain(states = [baseState], opts: RenderOptions = {}): string {
  return renderInterface(
    states,
    opts.currentRow ?? 0,
    opts.scrollOffset ?? 0,
    opts.maxVisibleItems ?? 10,
    false,
    opts.renderableItems,
    opts.activeFilterLabel,
    opts.packageManager,
    opts.filterMode,
    opts.filterQuery,
    opts.totalPackagesBeforeFilter,
    120,
    opts.loadingProgress,
    opts.auditProgress,
    undefined,
    opts.notice
  )
    .map(stripAnsi)
    .join('\n')
}

describe('package-list renderer', () => {
  it('renders pending rows with loading placeholders', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        loadState: 'pending',
        rangeVersion: 'loading',
        latestVersion: 'loading',
        hasRangeUpdate: false,
        hasMajorUpdate: false,
      },
      0,
      true,
      120
    )

    expect(line).toContain('loading')
  })

  it('renders failed rows as unavailable and keeps layout stable', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        loadState: 'failed',
        rangeVersion: 'unknown',
        latestVersion: 'unknown',
        hasRangeUpdate: false,
        hasMajorUpdate: false,
      },
      0,
      false,
      120
    )

    expect(line).toContain('unavailable')
  })

  it('renders every state variant at the same visual width so columns align', () => {
    const variants = [
      baseState,
      makeSelectionState({
        name: 'demo-pkg',
        vulnerability: {
          count: 2,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-high',
          advisories: [],
        },
      }),
      makeSelectionState({ name: 'demo-pkg', deprecated: 'use something else instead' }),
      makeSelectionState({
        name: 'demo-pkg',
        loadState: 'failed',
        rangeVersion: 'unknown',
        latestVersion: 'unknown',
        hasRangeUpdate: false,
        hasMajorUpdate: false,
      }),
      makeSelectionState({ name: '@scope/a-rather-long-package-name-for-testing' }),
      makeSelectionState({ name: 'demo-pkg', type: 'devDependencies' }),
      makeSelectionState({ name: 'demo-pkg', catalog: 'default' }),
      makeSelectionState({ name: 'demo-pkg', catalog: 'react19', type: 'devDependencies' }),
    ]

    // Rows use emoji badges and dot glyphs whose measured width feeds the
    // column math. Whatever the state (badges, selection, failures, long
    // names), every row must come out at the same visual width — one glyph
    // measured differently from how it renders would shift the whole column.
    for (const terminalWidth of [90, 120]) {
      const widths = variants.flatMap((state) => [
        VersionUtils.getVisualLength(renderPackageLine(state, 0, false, terminalWidth)),
        VersionUtils.getVisualLength(renderPackageLine(state, 0, true, terminalWidth)),
      ])
      expect(new Set(widths).size).toBe(1)
    }
  })

  it('marks catalog entries with a [C] badge', () => {
    const line = renderPackageLine(
      makeSelectionState({ name: 'demo-pkg', catalog: 'default' }),
      0,
      false,
      120
    )

    expect(stripAnsi(line)).toContain('[C]')
  })

  it('shows the catalog badge alongside the dep-type badge', () => {
    const line = renderPackageLine(
      makeSelectionState({ name: 'demo-pkg', catalog: 'react19', type: 'devDependencies' }),
      0,
      false,
      120
    )

    expect(stripAnsi(line)).toContain('[C][D]')
  })

  it('shows no catalog badge for regular dependencies', () => {
    expect(stripAnsi(renderPackageLine(baseState, 0, false, 120))).not.toContain('[C]')
  })

  it('uses fixed-width vulnerability badges so rows stay aligned', () => {
    const highLine = renderPackageLine(
      {
        ...baseState,
        vulnerability: {
          count: 2,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-high',
          advisories: [],
        },
      },
      0,
      false,
      120
    )

    const lowLine = renderPackageLine(
      {
        ...baseState,
        vulnerability: {
          count: 1,
          highestSeverity: 'low',
          detailsUrl: 'https://github.com/advisories/GHSA-low',
          advisories: [],
        },
      },
      0,
      false,
      120
    )

    expect(highLine).toContain('[HIGH]')
    expect(lowLine).toContain('[LOW]')
  })

  it('renders moderate badge without internal padding', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        vulnerability: {
          count: 1,
          highestSeverity: 'moderate',
          detailsUrl: 'https://github.com/advisories/GHSA-mod',
          advisories: [],
        },
      },
      0,
      false,
      120
    )

    expect(line).toContain('[MOD]')
    expect(line).not.toContain('[MOD ]')
  })

  it('hides peer dependency vulnerability badges by default', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        type: 'peerDependencies',
        vulnerability: {
          count: 1,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-peer',
          advisories: [],
        },
      },
      0,
      false,
      120
    )

    expect(line).not.toContain('[HIGH]')
    expect(line).toContain('[P]')
  })

  it('shows peer dependency vulnerability badges when enabled', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        type: 'peerDependencies',
        vulnerability: {
          count: 1,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-peer',
          advisories: [],
        },
      },
      0,
      false,
      120,
      { showPeerDependencyVulnerabilities: true }
    )

    expect(line).toContain('[HIGH]')
    expect(line).toContain('[P]')
  })

  it('hides optional dependency vulnerability badges by default', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        type: 'optionalDependencies',
        vulnerability: {
          count: 1,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-optional',
          advisories: [],
        },
      },
      0,
      false,
      120
    )

    expect(line).not.toContain('[HIGH]')
    expect(line).toContain('[O]')
  })

  it('shows optional dependency vulnerability badges when enabled', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        type: 'optionalDependencies',
        vulnerability: {
          count: 1,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-optional',
          advisories: [],
        },
      },
      0,
      false,
      120,
      { showOptionalDependencyVulnerabilities: true }
    )

    expect(line).toContain('[HIGH]')
    expect(line).toContain('[O]')
  })

  it('pads rendered list rows to the terminal width', () => {
    const lines = renderInterface(
      [baseState],
      0,
      0,
      10,
      false,
      [],
      'Deps',
      undefined,
      false,
      '',
      1,
      120
    )

    expect(lines.every((line) => VersionUtils.getVisualLength(line) >= 120)).toBe(true)
  })
})

describe('renderInterface header', () => {
  it('shows the package manager display name when known', () => {
    expect(renderPlain([baseState], { packageManager: npmInfo })).toContain('(npm)')
  })

  it('falls back to a generic logo header without a package manager', () => {
    const text = renderPlain()

    expect(text).toContain('inup')
    expect(text).not.toContain('(npm)')
  })

  it('appends the active filter label in both header variants', () => {
    expect(renderPlain([baseState], { activeFilterLabel: 'Dev only' })).toContain('- Dev only')
    expect(
      renderPlain([baseState], { activeFilterLabel: 'Dev only', packageManager: npmInfo })
    ).toContain('- Dev only')
  })

  it('shows the search input with a cursor while filtering', () => {
    const text = renderPlain([baseState], { filterMode: true, filterQuery: 'lodash' })

    expect(text).toContain('Search: lodash█')
  })

  it('shows an applied filter query with an edit hint', () => {
    const text = renderPlain([baseState], { filterMode: false, filterQuery: 'lodash' })

    expect(text).toContain('Search: lodash (press / to edit)')
  })

  it('shows the keymap footer hints when not filtering', () => {
    const text = renderPlain()

    expect(text).toContain('Move')
    expect(text).toContain('↑/↓')
  })
})

describe('renderInterface status line', () => {
  const many = Array.from({ length: 8 }, (_, i) => makeSelectionState({ name: `pkg-${i}` }))

  it('shows the visible range when the list is paginated', () => {
    expect(renderPlain(many, { maxVisibleItems: 3 })).toContain('Showing 1-3 of 8 packages')
  })

  it('shows the full count when everything fits', () => {
    expect(renderPlain(many, { maxVisibleItems: 20 })).toContain('Showing all 8 packages')
  })

  it('reports missing matches while filtering', () => {
    const text = renderPlain([], { filterMode: true, filterQuery: 'nope' })

    expect(text).toContain('No matches found')
    expect(text).toContain('Esc Clear')
  })

  it('reports paginated matches while filtering', () => {
    const text = renderPlain(many, { filterMode: true, filterQuery: 'pkg', maxVisibleItems: 3 })

    expect(text).toContain('Showing 1-3 of 8 matches')
    expect(text).toContain('Enter Apply')
  })

  it('reports all matches while filtering when they fit', () => {
    const text = renderPlain(many, { filterMode: true, filterQuery: 'pkg', maxVisibleItems: 20 })

    expect(text).toContain('Showing all 8 matches')
  })

  it('offers to clear an applied filter that narrowed the list', () => {
    const text = renderPlain(many.slice(0, 2), { totalPackagesBeforeFilter: 8 })

    expect(text).toContain('Showing all 2 matches')
    expect(text).toContain('Esc Clear filter')
  })

  it('shows the paginated match range for an applied filter', () => {
    const text = renderPlain(many.slice(0, 5), { totalPackagesBeforeFilter: 8, maxVisibleItems: 3 })

    expect(text).toContain('Showing 1-3 of 5 matches')
  })

  it('appends running audit progress', () => {
    const text = renderPlain([baseState], {
      auditProgress: { completed: 1, total: 5, isRunning: true, hasData: false },
    })

    expect(text).toContain('Audit 1/5')
  })

  it('shows a completed audit as full', () => {
    const text = renderPlain([baseState], {
      auditProgress: { completed: 5, total: 5, isRunning: false, hasData: true },
    })

    expect(text).toContain('Audit 5/5')
  })

  it('omits audit progress when nothing was audited', () => {
    const text = renderPlain([baseState], {
      auditProgress: { completed: 0, total: 0, isRunning: false, hasData: false },
    })

    expect(text).not.toMatch(/Audit \d+\/\d+/)
  })

  it('replaces the status line with a one-shot notice', () => {
    const text = renderPlain([baseState], { notice: 'Nothing selected' })

    expect(text).toContain('Nothing selected')
    expect(text).not.toContain('Showing all')
  })
})

describe('renderInterface body', () => {
  it('renders grouped items with section headers and spacers', () => {
    const items: RenderableItem[] = [
      { type: 'header', title: 'Dependencies', sectionType: 'main' },
      { type: 'package', state: makeSelectionState({ name: 'grouped-pkg' }), originalIndex: 0 },
      { type: 'spacer' },
      { type: 'header', title: 'Peer Dependencies', sectionType: 'peer' },
      { type: 'package', state: makeSelectionState({ name: 'peer-pkg' }), originalIndex: 1 },
    ]

    const text = renderPlain([baseState, baseState], {
      renderableItems: items,
      maxVisibleItems: 10,
    })

    expect(text).toContain('Dependencies')
    expect(text).toContain('Peer Dependencies')
    expect(text).toContain('grouped-pkg')
    expect(text).toContain('peer-pkg')
  })

  it('windows grouped items by scroll offset', () => {
    const items: RenderableItem[] = [
      { type: 'header', title: 'Dependencies', sectionType: 'main' },
      { type: 'package', state: makeSelectionState({ name: 'first-pkg' }), originalIndex: 0 },
      { type: 'package', state: makeSelectionState({ name: 'second-pkg' }), originalIndex: 1 },
    ]

    const text = renderPlain([baseState, baseState], {
      renderableItems: items,
      scrollOffset: 2,
      maxVisibleItems: 1,
    })

    expect(text).toContain('second-pkg')
    expect(text).not.toContain('first-pkg')
  })

  it('windows flat states by scroll offset', () => {
    const states = [
      makeSelectionState({ name: 'alpha-pkg' }),
      makeSelectionState({ name: 'beta-pkg' }),
      makeSelectionState({ name: 'gamma-pkg' }),
    ]

    const text = renderPlain(states, { scrollOffset: 1, maxVisibleItems: 1 })

    expect(text).toContain('beta-pkg')
    expect(text).not.toContain('alpha-pkg')
    expect(text).not.toContain('gamma-pkg')
  })

  it('appends loading progress while packages stream in', () => {
    const text = renderPlain([baseState], {
      loadingProgress: { discovered: 5, resolved: 2, total: 5, failed: 0, isLoading: true },
    })

    expect(text).toContain('Loading packages... (2/5 checked)')
    expect(text).not.toContain('unavailable')
  })

  it('appends the failure count to the loading line', () => {
    const text = renderPlain([baseState], {
      loadingProgress: { discovered: 5, resolved: 2, total: 5, failed: 2, isLoading: true },
    })

    expect(text).toContain('Loading packages... (2/5 checked) 2 unavailable')
  })

  it('omits the loading line when loading is done', () => {
    const text = renderPlain([baseState], {
      loadingProgress: { discovered: 5, resolved: 5, total: 5, failed: 0, isLoading: false },
    })

    expect(text).not.toContain('Loading packages')
  })
})

describe('renderPackagesTable', () => {
  it('reports up-to-date for empty and current package lists', () => {
    expect(stripAnsi(renderPackagesTable([]))).toContain('All packages are up to date!')
    expect(stripAnsi(renderPackagesTable([{ isOutdated: false }]))).toContain(
      'All packages are up to date!'
    )
  })

  it('renders the banner when outdated packages exist', () => {
    expect(stripAnsi(renderPackagesTable([{ isOutdated: true }]))).toContain('inup')
  })
})

describe('section primitives', () => {
  it('renders section headers for every section type', () => {
    for (const sectionType of ['main', 'peer', 'optional'] as const) {
      expect(stripAnsi(renderSectionHeader('Section Title', sectionType))).toContain(
        'Section Title'
      )
    }
  })

  it('renders an empty spacer row', () => {
    expect(stripAnsi(renderSpacer()).trim()).toBe('')
  })
})

describe('renderPackageLine option columns', () => {
  it('leaves both option columns blank for up-to-date packages', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        hasRangeUpdate: false,
        hasMajorUpdate: false,
        rangeVersion: '1.0.0',
        latestVersion: '1.0.0',
      },
      0,
      false,
      120
    )

    const text = stripAnsi(line)
    expect(text).toContain('demo-pkg')
    expect(text).toContain('^1.0.0') // current version stays visible
    expect(text).not.toContain('^1.1.0') // no range upgrade offered
    expect(text).not.toContain('^2.0.0') // no latest upgrade offered
  })

  it('shows only the latest column for major-only updates', () => {
    const line = renderPackageLine(
      { ...baseState, hasRangeUpdate: false, rangeVersion: '1.0.0' },
      0,
      false,
      120
    )

    const text = stripAnsi(line)
    expect(text).toContain('^2.0.0')
    expect(text).not.toContain('^1.1.0')
  })

  it('marks the selected option with a filled dot', () => {
    const selected = renderPackageLine({ ...baseState, selectedOption: 'latest' }, 0, false, 120)

    expect(stripAnsi(selected)).toContain('● ^2.0.0')
  })
})

describe('package-list render fallbacks', () => {
  it('renders a scoped name without a slash on both row states', () => {
    const state = makeSelectionState({ name: '@solo' })

    expect(stripAnsi(renderPackageLine(state, 0, true, 120))).toContain('@solo')
    expect(stripAnsi(renderPackageLine(state, 0, false, 120))).toContain('@solo')
  })

  it('pads the current-version column with spaces when dashes do not fit', () => {
    const state = makeSelectionState({ currentVersionSpecifier: '>=10.20.30-beta.12' })

    expect(stripAnsi(renderPackageLine(state, 0, false, 120))).toContain('>=10.20.30-beta.12')
  })

  it('colors the header with the provided color for unknown package managers', () => {
    const rendered = renderPlain([baseState], {
      packageManager: {
        ...npmInfo,
        name: 'other' as PackageManagerInfo['name'],
        displayName: 'Other PM',
        color: (text: string) => text,
      } as PackageManagerInfo,
    })

    expect(rendered).toContain('Other PM')
  })

  it('renders an empty search query cursor in filter mode', () => {
    const rendered = renderPlain([baseState], { filterMode: true, filterQuery: '' })

    expect(rendered).toContain('Search:')
  })

  it('skips renderable items of unknown type', () => {
    const rendered = renderPlain([baseState], {
      renderableItems: [{ type: 'mystery' } as unknown as RenderableItem],
    })

    expect(rendered).not.toContain('mystery')
  })
})
