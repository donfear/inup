import { describe, expect, it } from 'vitest'
import { renderPackageInfoModal } from '../../../src/ui/modal'
import { PackageSelectionState } from '../../../src/types'
import { getVisualLength, stripAnsi } from '../../../src/ui/utils'

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
