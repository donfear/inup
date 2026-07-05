import { describe, expect, it } from 'vitest'
import { buildReleaseNotesSections } from '../../../../src/features/interactive/modal/package-info-sections/release-notes'
import {
  buildPackageInfoSections,
  buildUsedBySections,
} from '../../../../src/features/interactive/modal/package-info-sections/sections'
import {
  formatTerminalLink,
  getRepositoryBaseUrl,
  isLowSignalTrailerLine,
  linkifyMarkdownText,
  pushWrappedLines,
  sanitizeMarkdownText,
} from '../../../../src/features/interactive/modal/package-info-sections/text'
import { getVisualLength, stripAnsi } from '../../../../src/shared/terminal/text'
import { makeSelectionState } from '../../../fixtures/selection-state-factory'

const MODAL_WIDTH = 70
const REPO = 'https://github.com/octo/demo'

const plain = (sections: ReturnType<typeof buildPackageInfoSections>) =>
  sections
    .flatMap((section) => section.rows)
    .map(stripAnsi)
    .join('\n')

describe('text helpers', () => {
  it('sanitizes markdown syntax and HTML tags', () => {
    expect(sanitizeMarkdownText('<b>**bold** `code` [link](https://x)</b>')).toBe('bold code link')
    expect(sanitizeMarkdownText('  spaced   out  ')).toBe('spaced out')
  })

  it('resolves the repository base url', () => {
    expect(getRepositoryBaseUrl(undefined)).toBeNull()
    expect(getRepositoryBaseUrl(`${REPO}/releases/`)).toBe(REPO)
  })

  it('linkifies contributor mentions, PR numbers, and commit hashes', () => {
    const linked = linkifyMarkdownText('fix by @octocat in #42 (abc1234)', REPO)

    expect(linked).toContain(formatTerminalLink('@octocat', 'https://github.com/octocat'))
    expect(linked).toContain(formatTerminalLink('#42', `${REPO}/pull/42`))
    expect(linked).toContain(formatTerminalLink('abc1234', `${REPO}/commit/abc1234`))
  })

  it('leaves references untouched without a GitHub repository', () => {
    expect(linkifyMarkdownText('see #42', 'https://gitlab.com/octo/demo')).toBe('see #42')
    expect(linkifyMarkdownText('see #42')).toBe('see #42')
  })

  it('pushes the bare prefix when there is nothing to wrap', () => {
    const lines: string[] = []
    pushWrappedLines(lines, '', 20, '  • ')
    expect(lines).toEqual(['  •'])
  })

  it('wraps long text across prefixed continuation lines', () => {
    const lines: string[] = []
    pushWrappedLines(lines, 'one two three four five six', 12, '• ', '  ')

    expect(lines[0]).toBe('• one two')
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.slice(1).every((line) => line.startsWith('  '))).toBe(true)
  })

  it('detects low-signal trailer lines', () => {
    expect(isLowSignalTrailerLine('Full Changelog: v1...v2')).toBe(true)
    expect(isLowSignalTrailerLine('compare view')).toBe(true)
    expect(isLowSignalTrailerLine('see https://x/compare/a...b')).toBe(true)
    expect(isLowSignalTrailerLine('changelog: https://example.com')).toBe(true)
    expect(isLowSignalTrailerLine('Added new feature')).toBe(false)
  })
})

describe('buildUsedBySections', () => {
  it('lists every dependent package.json with a summary', () => {
    const state = makeSelectionState({
      packageJsonPaths: ['/repo/a/package.json', '/repo/b/package.json'],
    })

    // Paths render via path.relative, so normalize Windows backslashes
    // before asserting.
    const text = plain(buildUsedBySections(state, MODAL_WIDTH)).replaceAll('\\', '/')

    expect(text).toContain('2 package.json files depend on test-pkg')
    expect(text).toContain('Type: dependencies')
    expect(text).toContain('a/package.json')
    expect(text).toContain('b/package.json')
  })

  it('falls back to the single path when no list exists', () => {
    const state = makeSelectionState({ packageJsonPaths: undefined })

    const text = plain(buildUsedBySections(state, MODAL_WIDTH))

    expect(text).toContain('1 package.json file depend')
  })
})

describe('buildPackageInfoSections (info tab)', () => {
  it('always renders the header and version meta', () => {
    const text = plain(buildPackageInfoSections(makeSelectionState(), MODAL_WIDTH, 'info'))

    expect(text).toContain('Package: test-pkg')
    expect(text).toContain('Unknown • MIT')
    expect(text).toContain('Current: ^1.0.0')
    expect(text).toContain('Target: 2.0.0')
  })

  it('uses the range version as target for range selections', () => {
    const state = makeSelectionState({ selectedOption: 'range' })

    expect(plain(buildPackageInfoSections(state, MODAL_WIDTH, 'info'))).toContain('Target: 1.1.0')
  })

  it('names the pnpm catalog for catalog-sourced entries', () => {
    const state = makeSelectionState({ catalog: 'react19' })

    const text = plain(buildPackageInfoSections(state, MODAL_WIDTH, 'info'))

    expect(text).toContain('Catalog: react19')
    expect(text).toContain('pnpm-workspace.yaml')
  })

  it('shows no catalog row for regular dependencies', () => {
    const text = plain(buildPackageInfoSections(makeSelectionState(), MODAL_WIDTH, 'info'))

    expect(text).not.toContain('Catalog:')
  })

  it('lists the referencing packages and full catalog contents on the usedBy tab', () => {
    const state = makeSelectionState({
      name: 'react',
      packageJsonPath: '/repo/pnpm-workspace.yaml',
      packageJsonPaths: ['/repo/pnpm-workspace.yaml'],
      catalog: 'default',
      catalogEntries: [
        { name: 'react', range: '^18.2.0' },
        { name: 'react-dom', range: '^18.2.0' },
        { name: 'lodash', range: '^4.17.0' },
      ],
      catalogReferencedBy: [
        '/repo/packages/web-app/package.json',
        '/repo/packages/ui/package.json',
      ],
    })

    const text = plain(buildPackageInfoSections(state, MODAL_WIDTH, 'usedBy'))

    // "Used by" answers with the real referencing packages, not the yaml path.
    expect(text).toContain('2 package.json files depend on react')
    expect(text).toContain('via catalog:default')
    expect(text).toContain('web-app')
    expect(text).toContain('ui')
    expect(text).not.toMatch(/• .*pnpm-workspace\.yaml/) // path list shows members, not the yaml

    // ...and shows everything else the catalog pins.
    expect(text).toContain('Catalog "default"')
    expect(text).toContain('react: ^18.2.0')
    expect(text).toContain('react-dom: ^18.2.0')
    expect(text).toContain('lodash: ^4.17.0')
  })

  it('keeps the plain used-by view for non-catalog entries', () => {
    const state = makeSelectionState({
      packageJsonPaths: ['/repo/a/package.json', '/repo/b/package.json'],
    })

    const text = plain(buildPackageInfoSections(state, MODAL_WIDTH, 'usedBy'))

    expect(text).toContain('2 package.json files depend on test-pkg')
    expect(text).not.toContain('via catalog')
    expect(text).not.toContain('Catalog "')
  })

  it('formats weekly downloads into human units', () => {
    const millions = makeSelectionState({ weeklyDownloads: 2_500_000 })
    const thousands = makeSelectionState({ weeklyDownloads: 12_300 })
    const small = makeSelectionState({ weeklyDownloads: 999 })

    expect(plain(buildPackageInfoSections(millions, MODAL_WIDTH, 'info'))).toContain('2.5M')
    expect(plain(buildPackageInfoSections(thousands, MODAL_WIDTH, 'info'))).toContain('12.3K')
    expect(plain(buildPackageInfoSections(small, MODAL_WIDTH, 'info'))).toContain('999')
  })

  it('warns about deprecation and node engine holds', () => {
    const state = makeSelectionState({
      deprecated: 'use replacement-pkg instead',
      enginesNode: '>=99',
    })

    const text = plain(buildPackageInfoSections(state, MODAL_WIDTH, 'info'))

    expect(text).toContain('Deprecated: use replacement-pkg instead')
    expect(text).toContain('Hold: requires Node >=99')
  })

  it('shows homepage, description, and repository links when present', () => {
    const state = makeSelectionState({
      homepage: 'https://example.com/home',
      description: 'A demo package for testing.',
      repository: REPO,
    })

    const text = plain(buildPackageInfoSections(state, MODAL_WIDTH, 'info'))

    expect(text).toContain('Homepage: https://example.com/home')
    expect(text).toContain('A demo package for testing.')
    expect(text).toContain(`Changelog: ${REPO}`)
  })

  it('summarizes vulnerabilities with a representative advisory and link', () => {
    const state = makeSelectionState({
      vulnerability: {
        count: 3,
        highestSeverity: 'high',
        detailsUrl: 'https://github.com/advisories/GHSA-demo',
        advisories: [
          {
            id: 'GHSA-demo',
            title: 'Prototype pollution',
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-demo',
          },
        ],
      },
    })

    const text = plain(buildPackageInfoSections(state, MODAL_WIDTH, 'info'))

    expect(text).toContain('3 known vulnerabilities (HIGH)')
    expect(text).toContain('[HIGH] Prototype pollution')
    expect(text).toContain('Security:')
    expect(text).toContain('... and 2 more')
  })

  it('switches to the used-by sections on the usedBy tab', () => {
    const text = plain(buildPackageInfoSections(makeSelectionState(), MODAL_WIDTH, 'usedBy'))

    expect(text).toContain('depend on test-pkg')
    expect(text).not.toContain('Current: ^1.0.0')
  })

  it('keeps every row within the content width for CJK/emoji registry text', () => {
    // Registry metadata is arbitrary text: CJK descriptions, deprecation
    // notices, and advisory titles all flow into modal rows. Any row wider
    // than the content area pushes the right border out of alignment.
    const state = makeSelectionState({
      description:
        '一个交互式命令行工具，用于升级过时的依赖项 🚀 パッケージ管理を簡単にするツールです、モノレポ対応',
      deprecated:
        'このパッケージは非推奨です。代わりに 别的包 を使ってください。移行ガイド: https://example.com/migrate',
      homepage: 'https://example.com/你好/文档/getting-started',
      vulnerability: {
        count: 1,
        highestSeverity: 'high',
        detailsUrl: 'https://github.com/advisories/GHSA-demo',
        advisories: [
          {
            id: 'GHSA-demo',
            title: '原型污染の脆弱性が発見されました、直ちにアップグレードしてください',
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-demo',
          },
        ],
      },
    })

    const sections = buildPackageInfoSections(state, MODAL_WIDTH, 'info')

    for (const section of sections) {
      for (const row of section.rows) {
        expect(getVisualLength(row)).toBeLessThanOrEqual(MODAL_WIDTH - 4)
      }
    }
  })
})

describe('buildReleaseNotesSections', () => {
  it('returns nothing without release note versions', () => {
    expect(buildReleaseNotesSections(makeSelectionState(), MODAL_WIDTH)).toEqual([])
    expect(
      buildReleaseNotesSections(makeSelectionState({ releaseNotesVersions: [] }), MODAL_WIDTH)
    ).toEqual([])
  })

  it('shows a loading row while notes are being fetched', () => {
    const state = makeSelectionState({
      releaseNotesVersions: ['2.0.0'],
      releaseNotesLoadingVersion: '2.0.0',
    })

    const text = plain(buildReleaseNotesSections(state, MODAL_WIDTH))

    expect(text).toContain('Loading release notes for v2.0.0...')
  })

  it('prompts to load when the version has not been fetched yet', () => {
    const state = makeSelectionState({ releaseNotesVersions: ['2.0.0'] })

    const text = plain(buildReleaseNotesSections(state, MODAL_WIDTH))

    expect(text).toContain('Press ←/→ to load release notes for v2.0.0')
  })

  it('reports when a fetched version has no notes', () => {
    const state = makeSelectionState({
      releaseNotesVersions: ['2.0.0'],
      releaseNotesLoaded: new Map([['2.0.0', null]]),
    })

    const text = plain(buildReleaseNotesSections(state, MODAL_WIDTH))

    expect(text).toContain('No release notes found for v2.0.0')
  })

  it('renders markdown notes with styled headings, bullets, and quotes', () => {
    const markdown = [
      '## Breaking Changes',
      '- removed old API',
      '## Features',
      '- added *new* thing by @octocat',
      '## Bug Fixes',
      '1. fixed the crash',
      '## Deprecations',
      '> [!WARNING]',
      '> use the new API',
      '```',
      'code fences are dropped',
      '```',
      '---',
      'Full Changelog: v1...v2',
    ].join('\n')

    const state = makeSelectionState({
      releaseNotesVersions: ['2.0.0', '1.5.0'],
      releaseNotesLoaded: new Map([['2.0.0', markdown]]),
      releaseNotesViewIndex: 0,
      repository: REPO,
    })

    const text = plain(buildReleaseNotesSections(state, MODAL_WIDTH))

    expect(text).toContain('Version 2.0.0')
    expect(text).toContain('(1/2)')
    expect(text).toContain('Breaking Changes')
    expect(text).toContain('• removed old API')
    expect(text).toContain('• added new thing by @octocat')
    expect(text).toContain('1. fixed the crash')
    expect(text).toContain('Warning')
    expect(text).toContain('use the new API')
    expect(text).not.toContain('```') // fence delimiters are dropped
    expect(text).not.toContain('---') // horizontal rules are dropped
    expect(text).toContain('→ older')
  })

  it('offers newer navigation from an older version', () => {
    const state = makeSelectionState({
      releaseNotesVersions: ['2.0.0', '1.5.0'],
      releaseNotesLoaded: new Map([['1.5.0', 'older notes']]),
      releaseNotesViewIndex: 1,
    })

    const text = plain(buildReleaseNotesSections(state, MODAL_WIDTH))

    expect(text).toContain('older notes')
    expect(text).toContain('← newer')
    expect(text).not.toContain('→ older')
  })

  it('returns nothing when the view index points past the versions', () => {
    const state = makeSelectionState({
      releaseNotesVersions: ['2.0.0'],
      releaseNotesViewIndex: 5,
    })

    expect(buildReleaseNotesSections(state, MODAL_WIDTH)).toEqual([])
  })
})
