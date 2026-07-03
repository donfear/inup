import { describe, expect, it } from 'vitest'
import { renderPackageInfoModal } from '../../../../src/features/interactive/modal'
import { PackageSelectionState } from '../../../../src/shared/types'
import { getVisualLength, stripAnsi } from '../../../../src/shared/terminal'

const baseState: PackageSelectionState = {
  name: 'next',
  packageJsonPath: '/repo/package.json',
  packageJsonPaths: ['/repo/package.json'],
  currentVersionSpecifier: '^16.1.6',
  currentVersion: '16.1.6',
  rangeVersion: '16.2.0',
  latestVersion: '16.2.3',
  selectedOption: 'range',
  loadState: 'ready',
  hasRangeUpdate: true,
  hasMajorUpdate: true,
  type: 'dependencies',
  description:
    'A framework for building web applications with React and server rendering features.',
  repository: 'https://github.com/vercel/next.js/releases',
  homepage: 'https://nextjs.org',
  weeklyDownloads: 37100000,
  author: 'Vercel',
  license: 'MIT',
}

describe('modal renderer', () => {
  it('keeps short release notes compact instead of forcing a tall scroll area', () => {
    const result = renderPackageInfoModal(
      {
        ...baseState,
        releaseNotesVersions: ['16.2.3'],
        releaseNotesLoaded: new Map([['16.2.3', '## Added\n- Faster startup\n- Better caching']]),
      },
      100,
      24
    )

    expect(result.usesInternalScroll).toBe(false)
    expect(result.maxScrollOffset).toBe(0)
    expect(result.lines.filter((line) => line.includes('│')).length).toBeLessThan(14)
  })

  it('shows no-release-notes message instead of load-more hint when no notes are found', () => {
    const result = renderPackageInfoModal(
      {
        ...baseState,
        releaseNotesVersions: ['16.2.3', '16.2.2'],
        releaseNotesLoaded: new Map([['16.2.3', null]]),
        releaseNotesViewIndex: 0,
      },
      100,
      24
    )

    expect(result.usesInternalScroll).toBe(false)
    expect(result.lines.join('\n')).toContain('No release notes found for v16.2.3')
    expect(result.lines.join('\n')).toContain('→ older')
  })

  it('renders homepage and vulnerability before changelog notes', () => {
    const result = renderPackageInfoModal(
      {
        ...baseState,
        vulnerability: {
          count: 1,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-1',
          advisories: [
            {
              id: 1,
              title: 'Critical auth bypass in middleware',
              severity: 'high',
              url: 'https://github.com/advisories/GHSA-1',
            },
          ],
        },
        releaseNotesVersions: ['16.2.3', '16.2.2'],
        releaseNotesLoaded: new Map([['16.2.3', '## Added\n- Faster startup']]),
        releaseNotesViewIndex: 0,
      },
      120,
      30
    )

    const rendered = result.lines.join('\n')
    const homepageIndex = rendered.indexOf('Homepage:')
    const vulnerabilityIndex = rendered.indexOf('1 known vulnerability')
    const changelogIndex = rendered.indexOf('Changelog:')
    const versionIndex = rendered.indexOf('Version 16.2.3')

    expect(homepageIndex).toBeGreaterThan(-1)
    expect(vulnerabilityIndex).toBeGreaterThan(homepageIndex)
    expect(changelogIndex).toBeGreaterThan(vulnerabilityIndex)
    expect(versionIndex).toBeGreaterThan(changelogIndex)
  })

  it('shows one canonical vulnerability link instead of many advisory URLs', () => {
    const result = renderPackageInfoModal(
      {
        ...baseState,
        vulnerability: {
          count: 3,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-1',
          advisories: [
            {
              id: 1,
              title: 'Critical auth bypass in middleware',
              severity: 'high',
              url: 'https://github.com/advisories/GHSA-1',
            },
            {
              id: 2,
              title: 'SSRF in image optimizer',
              severity: 'moderate',
              url: 'https://github.com/advisories/GHSA-2',
            },
          ],
        },
      },
      100,
      24
    )

    const rendered = result.lines.join('\n')
    expect(rendered).toContain('Security:')
    expect(rendered).toContain('https://github.com/advisories/GHSA-1')
    expect(rendered).toContain('... and 2 more')
    expect(rendered).not.toContain('https://github.com/advisories/GHSA-2')
  })

  it('formats release notes into readable headings and bullets without emoji copy', () => {
    const result = renderPackageInfoModal(
      {
        ...baseState,
        releaseNotesVersions: ['16.2.3'],
        releaseNotesLoaded: new Map([
          [
            '16.2.3',
            '## Breaking Changes\n\n- Remove legacy mode\n- Add new cache\n\nFull Changelog: https://example.com/compare',
          ],
        ]),
      },
      100,
      24
    )

    const rendered = result.lines.join('\n')
    expect(rendered).toContain('Package: next')
    expect(rendered).toContain('Breaking Changes')
    expect(rendered).toContain('• Remove legacy mode')
    expect(rendered).not.toContain('ℹ️')
    expect(rendered).not.toContain('📊')
    expect(rendered).not.toContain('⏳')
  })

  it('renders contributor mentions as terminal hyperlinks', () => {
    const result = renderPackageInfoModal(
      {
        ...baseState,
        releaseNotesVersions: ['16.2.3'],
        releaseNotesLoaded: new Map([
          ['16.2.3', '### Credits\n\nHuge thanks to @icyJoseph and @sokra for helping!'],
        ]),
      },
      100,
      24
    )

    const rendered = result.lines.join('\n')
    expect(rendered).toContain(
      '\u001b]8;;https://github.com/icyJoseph\u0007@icyJoseph\u001b]8;;\u0007'
    )
    expect(rendered).toContain('\u001b]8;;https://github.com/sokra\u0007@sokra\u001b]8;;\u0007')
  })

  it('renders pull request numbers and commit hashes as repository hyperlinks', () => {
    const result = renderPackageInfoModal(
      {
        ...baseState,
        repository: 'https://github.com/vercel/next.js/releases',
        releaseNotesVersions: ['16.2.3'],
        releaseNotesLoaded: new Map([
          ['16.2.3', '### Patch Changes\n\n- #13128 6c0b8e4 Thanks @pavelivanov!'],
        ]),
      },
      100,
      24
    )

    const rendered = result.lines.join('\n')
    expect(rendered).toContain(
      '\u001b]8;;https://github.com/vercel/next.js/pull/13128\u0007#13128\u001b]8;;\u0007'
    )
    expect(rendered).toContain(
      '\u001b]8;;https://github.com/vercel/next.js/commit/6c0b8e4\u00076c0b8e4\u001b]8;;\u0007'
    )
  })

  it('keeps inline repository links on the same wrapped line when space allows', () => {
    const result = renderPackageInfoModal(
      {
        ...baseState,
        repository: 'https://github.com/TanStack/query/releases',
        releaseNotesVersions: ['4.1.5'],
        releaseNotesLoaded: new Map([
          [
            '4.1.5',
            '### Patch Changes\n\n- #13155 3ba1583 Thanks @jerelmiller! - Fix an issue where useQuery would poll with pollInterval when skip was initialized to true.',
          ],
        ]),
      },
      120,
      24
    )

    const visibleLines = result.lines.map((line) => stripAnsi(line))
    const linkedLine = visibleLines.find((line) => line.includes('#13155'))

    expect(linkedLine).toBeDefined()
    expect(linkedLine).toContain('#13155 3ba1583 Thanks @jerelmiller!')
  })

  it('fits inside short terminal heights by trimming low-priority content', () => {
    const result = renderPackageInfoModal(
      {
        ...baseState,
        vulnerability: {
          count: 2,
          highestSeverity: 'moderate',
          detailsUrl: 'https://github.com/advisories/GHSA-1',
          advisories: [
            {
              id: 1,
              title:
                'Long representative advisory title that would otherwise force the modal to grow a lot',
              severity: 'moderate',
              url: 'https://github.com/advisories/GHSA-1',
            },
          ],
        },
      },
      90,
      12
    )

    expect(result.lines.length).toBeLessThanOrEqual(12)
    expect(result.lines.some((line) => line.includes('╭'))).toBe(true)
    expect(result.lines.some((line) => line.includes('╰'))).toBe(true)
  })

  it('uses internal scrolling only when release notes really overflow', () => {
    const result = renderPackageInfoModal(
      {
        ...baseState,
        releaseNotesVersions: ['16.2.3'],
        releaseNotesLoaded: new Map([
          [
            '16.2.3',
            Array.from({ length: 18 }, (_, index) => `- Change number ${index + 1}`).join('\n'),
          ],
        ]),
      },
      90,
      16
    )

    expect(result.usesInternalScroll).toBe(true)
    expect(result.maxScrollOffset).toBeGreaterThan(0)
  })

  it('can scroll all the way to the final release note row', () => {
    const state: PackageSelectionState = {
      ...baseState,
      releaseNotesVersions: ['16.2.3'],
      releaseNotesLoaded: new Map([
        [
          '16.2.3',
          Array.from({ length: 18 }, (_, index) => `- Change number ${index + 1}`).join('\n'),
        ],
      ]),
    }

    const initial = renderPackageInfoModal(state, 90, 16)
    const atBottom = renderPackageInfoModal(state, 90, 16, initial.maxScrollOffset)
    const rendered = atBottom.lines.join('\n')

    expect(rendered).toContain('Change number 18')
    expect(rendered).toContain('End of release notes')
  })

  it('shows a visible loading indicator while fetching a different version in scroll mode', () => {
    const result = renderPackageInfoModal(
      {
        ...baseState,
        releaseNotesVersions: ['16.2.3', '16.2.2'],
        releaseNotesLoaded: new Map([
          [
            '16.2.3',
            Array.from({ length: 18 }, (_, index) => `- Change number ${index + 1}`).join('\n'),
          ],
        ]),
        releaseNotesViewIndex: 0,
        releaseNotesLoadingVersion: '16.2.2',
      },
      90,
      16,
      0
    )

    expect(result.usesInternalScroll).toBe(true)
    expect(result.lines.join('\n')).toContain('Loading release notes for v16.2.2')
  })

  it('keeps vulnerability rows aligned with the modal frame width', () => {
    const result = renderPackageInfoModal(
      {
        ...baseState,
        vulnerability: {
          count: 6,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-q4gf-8mx6-v5v3',
          advisories: [
            {
              id: 1,
              title: 'Next.js has a Denial of Service with Server Components',
              severity: 'high',
              url: 'https://github.com/advisories/GHSA-q4gf-8mx6-v5v3',
            },
          ],
        },
      },
      120,
      24
    )

    const framedLines = result.lines.filter(
      (line) => line.includes('│') || line.includes('╭') || line.includes('╰') || line.includes('├')
    )
    const widths = framedLines.map((line) => getVisualLength(line))
    expect(new Set(widths).size).toBe(1)
  })
})

// A state with no optional metadata: only the required header + meta sections
// render, which lets the scroll-geometry tests below control every row.
const minimalState: PackageSelectionState = {
  name: 'tiny',
  packageJsonPath: '/repo/package.json',
  packageJsonPaths: ['/repo/package.json'],
  currentVersionSpecifier: '^1.0.0',
  currentVersion: '1.0.0',
  rangeVersion: '1.1.0',
  latestVersion: '2.0.0',
  selectedOption: 'range',
  loadState: 'ready',
  hasRangeUpdate: true,
  hasMajorUpdate: true,
  type: 'dependencies',
}

describe('modal renderer edge paths', () => {
  it('shows N/A downloads and an uncounted Used-by tab for an unused package', () => {
    const result = renderPackageInfoModal(
      { ...minimalState, weeklyDownloads: 0, packageJsonPaths: [] },
      100,
      24
    )

    const rendered = stripAnsi(result.lines.join('\n'))
    expect(rendered).toContain('Downloads/week: N/A')
    expect(rendered).toContain('Used by ]')
    expect(rendered).not.toContain('Used by (')
  })

  it('renders used-by paths relative to cwd, keeping cwd itself absolute', () => {
    const result = renderPackageInfoModal(
      {
        ...minimalState,
        packageJsonPaths: [process.cwd(), `${process.cwd()}/packages/a/package.json`],
      },
      120,
      30,
      0,
      'usedBy'
    )

    const rendered = stripAnsi(result.lines.join('\n'))
    expect(rendered).toContain('2 package.json files depend on tiny')
    // path.relative(cwd, cwd) is '' — the absolute path is the fallback.
    expect(rendered).toContain(process.cwd())
    expect(rendered).toContain('packages/a/package.json')
  })

  it('truncates the fourth description line instead of overflowing', () => {
    const result = renderPackageInfoModal(
      { ...minimalState, description: 'wordy '.repeat(80).trim() },
      100,
      40
    )

    const rendered = result.lines.map((line) => stripAnsi(line))
    const descriptionRows = rendered.filter((line) => line.includes('wordy'))
    // The description wraps to more than four lines but is capped at four.
    expect(descriptionRows).toHaveLength(4)
  })

  it('omits the vulnerability link row when no advisory details exist', () => {
    const result = renderPackageInfoModal(
      {
        ...minimalState,
        vulnerability: { count: 2, highestSeverity: 'low', detailsUrl: '', advisories: [] },
      },
      100,
      24
    )

    const rendered = stripAnsi(result.lines.join('\n'))
    expect(rendered).toContain('2 known vulnerabilities')
    expect(rendered).toContain('... and 1 more')
    expect(rendered).not.toContain('https://')
  })

  it('falls back to the representative advisory url when detailsUrl is missing', () => {
    const result = renderPackageInfoModal(
      {
        ...minimalState,
        vulnerability: {
          count: 1,
          highestSeverity: 'low',
          detailsUrl: '',
          advisories: [
            { id: 9, title: 'Prototype pollution', severity: 'low', url: 'https://osv.dev/GHSA-9' },
          ],
        },
      },
      100,
      24
    )

    expect(stripAnsi(result.lines.join('\n'))).toContain('https://osv.dev/GHSA-9')
  })

  it('formats awkward release-notes markdown: admonitions, blanks, fences, breaking bullets', () => {
    const notes = [
      '',
      '> [!NOTE]',
      'Some intro',
      '',
      '',
      '**',
      // Long enough to wrap: the continuation lines must stay red-styled too.
      `- breaking: drops Node 18 and ${'rewrites the module resolution pipeline '.repeat(4)}end`,
      '```',
      'code sample',
      '```',
      '',
    ].join('\n')
    const result = renderPackageInfoModal(
      {
        ...minimalState,
        releaseNotesVersions: ['1.1.0'],
        releaseNotesLoaded: new Map([['1.1.0', notes]]),
      },
      100,
      40
    )

    const rendered = stripAnsi(result.lines.join('\n'))
    expect(rendered).toContain('Note')
    expect(rendered).toContain('Some intro')
    expect(rendered).toContain('breaking: drops Node 18')
    expect(rendered).toContain('code sample')
  })

  it('scrolls the Used-by tab and renders the body separator inside the window', () => {
    const result = renderPackageInfoModal(
      {
        ...minimalState,
        catalog: 'default',
        catalogEntries: [
          { name: 'tiny', range: '^1.0.0' },
          { name: 'react', range: '^19.0.0' },
          { name: 'lodash', range: '^4.17.0' },
          { name: 'chalk', range: '^5.0.0' },
          { name: 'zod', range: '^3.0.0' },
        ],
        catalogReferencedBy: ['/repo/packages/a/package.json', '/repo/packages/b/package.json'],
      },
      80,
      12,
      0,
      'usedBy'
    )

    expect(result.usesInternalScroll).toBe(true)
    expect(result.maxScrollOffset).toBeGreaterThan(0)
    const rendered = stripAnsi(result.lines.join('\n'))
    expect(rendered).toContain('Lines 1-')
    // The window starts at the top: both used-by rows plus the separator into
    // the catalog section are inside the visible slice.
    expect(rendered).toContain('packages/a/package.json')
  })

  it('renders a scrolling modal with no footer when the body fits exactly', () => {
    // Geometry: header(2)+summary(2)+separator = 5 pinned rows, 3 body rows,
    // maxHeight 10 → the frame is one row too tall for compact mode but the
    // body fits the scroll window exactly, so no footer status is shown.
    const result = renderPackageInfoModal(
      {
        ...minimalState,
        packageJsonPaths: [
          '/repo/packages/a/package.json',
          '/repo/packages/b/package.json',
          '/repo/packages/c/package.json',
        ],
      },
      80,
      12,
      0,
      'usedBy'
    )

    expect(result.usesInternalScroll).toBe(true)
    expect(result.maxScrollOffset).toBe(0)
    const rendered = stripAnsi(result.lines.join('\n'))
    expect(rendered).toContain('packages/c/package.json')
    expect(rendered).not.toContain('Lines 1-')
    expect(rendered).not.toContain('End of release notes')
  })

  it('builds direction hints while scrolling when newer versions exist', () => {
    // Empty-rendering notes ('```' fences only) make the body exactly
    // versionHeader + separator + nav = 3 rows, which fits the floor of 3
    // visible rows and exercises the hint construction in scroll mode.
    const result = renderPackageInfoModal(
      {
        ...minimalState,
        deprecated: 'no longer maintained',
        releaseNotesVersions: ['3.0.0', '2.0.0', '1.0.0'],
        releaseNotesViewIndex: 2,
        releaseNotesLoaded: new Map([['1.0.0', '```\n```']]),
      },
      80,
      12,
      0
    )

    expect(result.usesInternalScroll).toBe(true)
    expect(result.maxScrollOffset).toBe(1)
    expect(stripAnsi(result.lines.join('\n'))).toContain('Lines 1-2 of 3')
  })

  it('builds direction hints while scrolling when older versions exist', () => {
    const result = renderPackageInfoModal(
      {
        ...minimalState,
        deprecated: 'no longer maintained',
        releaseNotesVersions: ['2.0.0', '1.0.0'],
        releaseNotesViewIndex: 0,
        releaseNotesLoaded: new Map([['2.0.0', '```\n```']]),
      },
      80,
      12,
      0
    )

    expect(result.usesInternalScroll).toBe(true)
    expect(result.maxScrollOffset).toBe(1)
    expect(stripAnsi(result.lines.join('\n'))).toContain('Lines 1-2 of 3')
  })
})
