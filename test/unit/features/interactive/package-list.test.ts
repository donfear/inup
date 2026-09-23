import { describe, expect, it } from 'vitest'
import {
  computeVersionColumnWidths,
  padLineToWidth,
  renderInterface,
  renderPackageLine,
} from '../../../../src/features/interactive/renderer/package-list'
import { VersionUtils } from '../../../../src/features/interactive/renderer/version-format'
import { stripAnsi } from '../../../../src/shared/terminal/text'
import type { PackageManagerInfo } from '../../../../src/shared/types'
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
  activeFilterLabel?: string
  packageManager?: PackageManagerInfo
  filterMode?: boolean
  filterQuery?: string
  totalPackagesBeforeFilter?: number
  loadingProgress?: Parameters<typeof renderInterface>[10]
  auditProgress?: Parameters<typeof renderInterface>[11]
  notice?: string | null
  terminalWidth?: number
  selectedCount?: number
}

function renderPlain(states = [baseState], opts: RenderOptions = {}): string {
  return renderInterface(
    states,
    opts.currentRow ?? 0,
    opts.scrollOffset ?? 0,
    opts.maxVisibleItems ?? 10,
    opts.activeFilterLabel,
    opts.packageManager,
    opts.filterMode,
    opts.filterQuery,
    opts.totalPackagesBeforeFilter,
    opts.terminalWidth ?? 120,
    opts.loadingProgress,
    opts.auditProgress,
    { selectedCount: opts.selectedCount },
    opts.notice
  )
    .map(stripAnsi)
    .join('\n')
}

describe('package-list renderer', () => {
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
      makeSelectionState({ name: 'demo-pkg', hasRangeUpdate: false, hasMajorUpdate: false }),
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
        VersionUtils.getVisualLength(renderPackageLine(state, false, terminalWidth)),
        VersionUtils.getVisualLength(renderPackageLine(state, true, terminalWidth)),
      ])
      expect(new Set(widths).size).toBe(1)
    }
  })

  it('marks catalog entries with a [C] badge', () => {
    const line = renderPackageLine(
      makeSelectionState({ name: 'demo-pkg', catalog: 'default' }),
      false,
      120
    )

    expect(stripAnsi(line)).toContain('[C]')
  })

  it('shows the catalog badge alongside the dep-type badge', () => {
    const line = renderPackageLine(
      makeSelectionState({ name: 'demo-pkg', catalog: 'react19', type: 'devDependencies' }),
      false,
      120
    )

    expect(stripAnsi(line)).toContain('[C][D]')
  })

  it('shows no catalog badge for regular dependencies', () => {
    expect(stripAnsi(renderPackageLine(baseState, false, 120))).not.toContain('[C]')
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
      false,
      120,
      { showOptionalDependencyVulnerabilities: true }
    )

    expect(line).toContain('[HIGH]')
    expect(line).toContain('[O]')
  })

  it('pads rendered list rows to the terminal width', () => {
    const lines = renderInterface([baseState], 0, 0, 10, 'Deps', undefined, false, '', 1, 120)

    expect(lines.every((line) => VersionUtils.getVisualLength(line) >= 120)).toBe(true)
  })
})

describe('renderInterface header', () => {
  it.each(['discovering', 'collecting'] as const)(
    'renders one %s status for the empty first frame',
    (phase) => {
      const text = renderPlain([], {
        loadingProgress: {
          phase,
          discovered: 0,
          resolved: 0,
          total: 0,
          failed: 0,
          isLoading: true,
          packageJsonFiles: 2,
        },
      })
      expect(text).toContain(
        phase === 'discovering'
          ? 'Scanning for package.json files…'
          : 'Reading dependencies from 2 package.json files…'
      )
      expect(text).not.toContain('Confirm')
      expect(text).not.toContain('Loading packages')
      expect(text.trimEnd().split('\n')).toHaveLength(4)
    }
  )

  it('includes scan details only when they fit and truncates the base label on tiny screens', () => {
    const loadingProgress = {
      phase: 'discovering' as const,
      discovered: 0,
      resolved: 0,
      total: 0,
      failed: 0,
      isLoading: true,
      scanningDir: 'packages/api',
    }
    expect(renderPlain([], { loadingProgress })).toContain('packages/api (found 0)')
    const narrow = renderPlain([], { terminalWidth: 40, loadingProgress })
    expect(narrow).not.toContain('packages/api')
    const tiny = renderPlain([], { terminalWidth: 20, loadingProgress })
    expect(tiny.split('\n').every((line) => line.length <= 20)).toBe(true)
    const collecting = { ...loadingProgress, phase: 'collecting' as const }
    expect(renderPlain([baseState], { loadingProgress: collecting })).toContain(
      'Reading dependencies from 0 package.json files…'
    )
  })
  it.each([20, 40, 60, 80, 120])('fits the shortcut footer within %s columns', (terminalWidth) => {
    const footer = renderPlain([baseState], { terminalWidth }).split('\n')[2]
    expect(VersionUtils.getVisualLength(footer)).toBeLessThanOrEqual(terminalWidth)
    if (terminalWidth >= 40) {
      expect(footer).toContain('? Help')
      expect(footer).toContain('q Quit')
    }
    if (terminalWidth === 60) expect(footer).not.toContain('i Info')
    if (terminalWidth === 120) expect(footer).toContain('i Info')
  })
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

  it('flags a failed audit instead of showing it complete', () => {
    const text = renderPlain([baseState], {
      auditProgress: { completed: 5, total: 5, failed: 2, isRunning: false, hasData: true },
    })

    expect(text).toContain('Audit failed')
    expect(text).not.toContain('Audit 5/5')
  })

  it('omits audit progress when nothing was audited', () => {
    const text = renderPlain([baseState], {
      auditProgress: { completed: 0, total: 0, isRunning: false, hasData: false },
    })

    expect(text).not.toMatch(/Audit \d+\/\d+/)
  })

  it('counts the selected packages', () => {
    const states = [
      makeSelectionState({ name: 'a', selectedOption: 'range' }),
      makeSelectionState({ name: 'b', selectedOption: 'latest' }),
      makeSelectionState({ name: 'c' }),
    ]
    const text = renderPlain(states, { selectedCount: 2 })

    expect(text).toContain('2 selected')
    expect(text).not.toContain('hidden')
  })

  it('says how many selected packages the current filter hides', () => {
    const visible = [makeSelectionState({ name: 'a', selectedOption: 'range' })]
    const text = renderPlain(visible, { totalPackagesBeforeFilter: 8, selectedCount: 3 })

    expect(text).toContain('3 selected (2 hidden)')
  })

  it('shows no count while nothing is selected', () => {
    expect(renderPlain(many, { selectedCount: 0 })).not.toContain('selected')
  })

  it('replaces the status line with a one-shot notice', () => {
    const text = renderPlain([baseState], { notice: 'Nothing selected' })

    expect(text).toContain('Nothing selected')
    expect(text).not.toContain('Showing all')
  })
})

describe('renderInterface body', () => {
  it('windows rows by scroll offset', () => {
    const states = [
      makeSelectionState({ name: 'first-pkg' }),
      makeSelectionState({ name: 'second-pkg' }),
    ]

    const text = renderPlain(states, { scrollOffset: 1, maxVisibleItems: 1 })

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

  it('keeps the failure count on the status line once loading is done', () => {
    const text = renderPlain([baseState], {
      loadingProgress: { discovered: 5, resolved: 5, total: 5, failed: 2, isLoading: false },
    })

    expect(text).not.toContain('Loading packages')
    expect(text).toContain('Showing all 1 packages  Enter Confirm  2 unavailable')
  })

  it('flags a slow connection on the loading line', () => {
    const text = renderPlain([baseState], {
      loadingProgress: {
        discovered: 50,
        resolved: 12,
        total: 50,
        failed: 0,
        isLoading: true,
        slowNetwork: true,
      },
    })

    expect(text).toContain('Loading packages... (12/50 checked)')
    expect(text).toContain('slow connection, reduced parallelism')
  })

  it('does not mention the connection when it is not slow', () => {
    const text = renderPlain([baseState], {
      loadingProgress: { discovered: 5, resolved: 2, total: 5, failed: 0, isLoading: true },
    })

    expect(text).not.toContain('slow connection')
  })

  it('drops the slow-connection hint before overflowing a narrow terminal', () => {
    const width = 60
    const text = renderPlain([baseState], {
      terminalWidth: width,
      loadingProgress: {
        discovered: 100,
        resolved: 42,
        total: 100,
        failed: 3,
        isLoading: true,
        slowNetwork: true,
      },
    })

    // The hint is informational; the loading line is not allowed to wrap.
    expect(text).not.toContain('slow connection')
    const loadingLine = text.split('\n').find((line) => line.includes('Loading packages'))
    expect(loadingLine).toBeDefined()
    expect(loadingLine!.length).toBeLessThanOrEqual(width)
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
      false,
      120
    )

    const text = stripAnsi(line)
    expect(text).toContain('^2.0.0')
    expect(text).not.toContain('^1.1.0')
  })

  it('marks the selected option with a filled dot', () => {
    const selected = renderPackageLine({ ...baseState, selectedOption: 'latest' }, false, 120)

    expect(stripAnsi(selected)).toContain('● ^2.0.0')
  })
})

describe('version column sizing for long prerelease versions', () => {
  const longState = makeSelectionState({
    name: 'next',
    currentVersionSpecifier: '^16.0.0-preview.9',
    currentVersion: '16.0.0-preview.9',
    rangeVersion: '16.0.0-preview.10',
    latestVersion: '16.0.0-preview.10',
    hasRangeUpdate: true,
    hasMajorUpdate: true,
  })

  it('keeps default column widths when every version fits', () => {
    const widths = computeVersionColumnWidths([baseState], 120)

    expect(widths).toEqual({ current: 16, range: 16, latest: 16 })
  })

  it('grows columns to fit long prerelease versions on a wide terminal', () => {
    // ^16.0.0-preview.10 = 18 visual chars, +3 column overhead = 21.
    const widths = computeVersionColumnWidths([baseState, longState], 120)

    expect(widths).toEqual({ current: 20, range: 21, latest: 21 })
  })

  it('shows the full prerelease version when the terminal has room', () => {
    const text = renderPlain([longState], { terminalWidth: 120 })

    expect(text).toContain('^16.0.0-preview.9')
    expect(text).toContain('^16.0.0-preview.10')
    expect(text).not.toContain('…')
  })

  it('never grows columns past the name-column minimum on a narrow terminal', () => {
    // 84 columns leave zero growth budget: name keeps its 24 minimum.
    const widths = computeVersionColumnWidths([longState], 84)

    expect(widths).toEqual({ current: 16, range: 16, latest: 16 })
  })

  it('splits a short growth budget round-robin across the columns', () => {
    // 88 columns leave a pool of 4: +2 current, +1 range, +1 latest.
    const widths = computeVersionColumnWidths([longState], 88)

    expect(widths).toEqual({ current: 18, range: 17, latest: 17 })
  })

  it('caps column growth for absurdly long versions', () => {
    const absurd = makeSelectionState({
      currentVersionSpecifier: '^1.0.0-canary.20260729093015.sha.abcdef12',
      hasRangeUpdate: false,
      hasMajorUpdate: false,
    })
    const widths = computeVersionColumnWidths([absurd], 200)

    expect(widths.current).toBe(24)
  })

  it('middle-truncates a version that cannot fit its column', () => {
    const lines = renderInterface([longState], 0, 0, 10, undefined, undefined, false, '', 1, 84)
    const row = lines.map(stripAnsi).find((line) => line.includes('next'))

    expect(row).toBeDefined()
    expect(row).toContain('…')
    expect(row).not.toContain('^16.0.0-preview.10')
    // Both ends of the version survive the ellipsis
    expect(row).toMatch(/\^16\.0\.[^ ]*…[^ ]*w\.10/)
  })

  it('keeps every row at the same visual width when versions overflow', () => {
    for (const terminalWidth of [84, 100, 120]) {
      const widths = computeVersionColumnWidths([baseState, longState], terminalWidth)
      const rowWidths = [baseState, longState].flatMap((state) => [
        VersionUtils.getVisualLength(renderPackageLine(state, false, terminalWidth, {}, widths)),
        VersionUtils.getVisualLength(renderPackageLine(state, true, terminalWidth, {}, widths)),
      ])
      expect(new Set(rowWidths).size).toBe(1)
    }
  })

  it('never overflows the terminal when badges, a long name, and grown columns combine', () => {
    // Worst case: saturated name column + [HIGH] + [DEPR] + [D] badges while
    // long prerelease versions grow every version column. The name budget
    // must absorb the badges or the row wraps and corrupts the frame.
    const loaded = makeSelectionState({
      name: '@a-very-long-scope/an-extremely-long-package-name-for-testing',
      currentVersionSpecifier: '^16.0.0-preview.9',
      rangeVersion: '16.0.0-preview.10',
      latestVersion: '16.0.0-preview.10',
      hasRangeUpdate: true,
      hasMajorUpdate: true,
      type: 'devDependencies',
      deprecated: 'this package is deprecated',
      vulnerability: {
        count: 1,
        highestSeverity: 'high',
        detailsUrl: 'https://github.com/advisories/GHSA-x',
        advisories: [],
      },
    })
    for (const terminalWidth of [84, 100, 111, 120, 139, 160]) {
      const widths = computeVersionColumnWidths([loaded, longState], terminalWidth)
      const badgedRow = renderPackageLine(loaded, false, terminalWidth, {}, widths)
      const plainRow = renderPackageLine(longState, false, terminalWidth, {}, widths)

      expect(VersionUtils.getVisualLength(badgedRow)).toBeLessThanOrEqual(terminalWidth)
      expect(VersionUtils.getVisualLength(badgedRow)).toBe(VersionUtils.getVisualLength(plainRow))
    }
  })
})

describe('package-list render fallbacks', () => {
  it('renders a scoped name without a slash on both row states', () => {
    const state = makeSelectionState({ name: '@solo' })

    expect(stripAnsi(renderPackageLine(state, true, 120))).toContain('@solo')
    expect(stripAnsi(renderPackageLine(state, false, 120))).toContain('@solo')
  })

  it('pads the current-version column with spaces when dashes do not fit', () => {
    // 13 visual chars fill the default 16-wide column exactly (dot + space +
    // version + trailing space) — no room for dashes, spaces only.
    const state = makeSelectionState({ currentVersionSpecifier: '>=10.20.30-b1' })

    expect(stripAnsi(renderPackageLine(state, false, 120))).toContain('>=10.20.30-b1')
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
})

describe('narrow terminals', () => {
  // The session diff-writes rows by absolute screen position, so a single
  // line wider than the terminal wraps, scrolls the frame and every later
  // update lands on the wrong row. Nothing rendered may exceed the width.
  const states = [
    baseState,
    makeSelectionState({
      name: '@a-very-long-scope/an-extremely-long-package-name-for-testing',
      type: 'devDependencies',
      catalog: 'default',
      deprecated: 'use something else instead',
      vulnerability: {
        count: 1,
        highestSeverity: 'high',
        detailsUrl: 'https://github.com/advisories/GHSA-x',
        advisories: [],
      },
    }),
    makeSelectionState({
      name: 'next',
      currentVersionSpecifier: '^16.0.0-preview.9',
      rangeVersion: '16.0.0-preview.10',
      latestVersion: '16.0.0-preview.10',
      selectedOption: 'latest',
    }),
    makeSelectionState({ name: 'up-to-date', hasRangeUpdate: false, hasMajorUpdate: false }),
  ]

  it.each([80, 70, 60])('keeps every frame line within %s columns', (terminalWidth) => {
    const lines = renderInterface(
      states,
      1,
      0,
      10,
      'Dev only',
      npmInfo,
      true,
      'a-search-query-long-enough-to-crowd-the-narrowest-terminal-we-render',
      8,
      terminalWidth,
      { discovered: 8, resolved: 4, total: 8, failed: 1, isLoading: true, slowNetwork: true },
      { completed: 1, total: 8, isRunning: true, hasData: false },
      { cooldown: { heldCount: 3, unsupported: false } }
    )

    const widest = Math.max(...lines.map((line) => VersionUtils.getVisualLength(line)))
    expect(widest).toBeLessThanOrEqual(terminalWidth)
  })

  it.each([83, 80, 78, 70, 60])(
    'squeezes rows to fit %s columns without cutting any column off',
    (terminalWidth) => {
      const widths = computeVersionColumnWidths(states, terminalWidth)
      const rows = states.flatMap((state) => [
        renderPackageLine(state, false, terminalWidth, {}, widths),
        renderPackageLine(state, true, terminalWidth, {}, widths),
      ])

      // Same width as a wide row (one short of the edge), so columns align.
      expect(new Set(rows.map((row) => VersionUtils.getVisualLength(row)))).toEqual(
        new Set([terminalWidth - 1])
      )
      const plain = stripAnsi(rows[0])
      expect(plain).toContain('demo-pkg')
      expect(plain).toMatch(/● \^1\.0\.0.*○ \^1\.1\.0.*○ \^2\.0\.0/)
      expect(rows.map(stripAnsi).join('\n')).not.toContain('...')
    }
  )

  it('closes the gaps before shrinking the version columns', () => {
    expect(computeVersionColumnWidths(states, 78)).toEqual({ current: 16, range: 16, latest: 16 })
    // 70 columns: 6 from the gaps, the other 8 round-robin from the columns.
    expect(computeVersionColumnWidths(states, 70)).toEqual({ current: 13, range: 13, latest: 14 })
    expect(computeVersionColumnWidths(states, 60)).toEqual({ current: 10, range: 10, latest: 10 })
    // The columns stop at their floor; anything narrower is cut at the edge.
    expect(computeVersionColumnWidths(states, 40)).toEqual({ current: 10, range: 10, latest: 10 })
  })

  it('sizes a row without precomputed columns for the terminal it renders into', () => {
    const row = renderPackageLine(baseState, false, 70)

    expect(VersionUtils.getVisualLength(row)).toBe(69)
  })

  it('cuts a line that still overflows at the edge, keeping its colors closed', () => {
    const line = padLineToWidth(`\x1b[31m${'x'.repeat(70)}\x1b[39m`, 50)

    expect(VersionUtils.getVisualLength(line)).toBe(50)
    expect(stripAnsi(line)).toBe(`${'x'.repeat(47)}...`)
    expect(line.endsWith('\x1b[39m')).toBe(true)
  })

  it('cuts rows at the edge once the squeeze runs out', () => {
    const text = renderPlain(states, { terminalWidth: 50 })

    expect(text.split('\n').every((line) => VersionUtils.getVisualLength(line) === 50)).toBe(true)
  })
})
