import { describe, expect, it } from 'vitest'
import {
  extractVersionSection,
  normalizeReleaseTag,
} from '../../../../src/features/changelog/parsers/changelog-parser'

describe('normalizeReleaseTag', () => {
  it('returns null for missing tags', () => {
    expect(normalizeReleaseTag(undefined)).toBeNull()
    expect(normalizeReleaseTag('')).toBeNull()
  })

  it('cleans plain and v-prefixed semver tags', () => {
    expect(normalizeReleaseTag('1.2.3')).toBe('1.2.3')
    expect(normalizeReleaseTag('v1.2.3')).toBe('1.2.3')
    expect(normalizeReleaseTag(' v1.2.3 ')).toBe('1.2.3')
  })

  it('extracts embedded semver from package-prefixed tags', () => {
    expect(normalizeReleaseTag('my-pkg@1.2.3')).toBe('1.2.3')
    expect(normalizeReleaseTag('release/2.0.0')).toBe('2.0.0')
  })

  it('keeps prerelease identifiers', () => {
    expect(normalizeReleaseTag('v2.0.0-beta.1')).toBe('2.0.0-beta.1')
  })

  it('returns null when no semver is embedded', () => {
    expect(normalizeReleaseTag('release-2024')).toBeNull()
    expect(normalizeReleaseTag('latest')).toBeNull()
  })
})

describe('extractVersionSection', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [2.0.0] - 2024-06-01',
    '',
    '- breaking change',
    '',
    '## v1.2.3 - 2024-01-01',
    '',
    '- fix things',
    '- add stuff',
    '',
    '## 1.0.0',
    '',
    '- initial release',
  ].join('\n')

  it('extracts a bracketed heading section up to the next section', () => {
    expect(extractVersionSection(changelog, '2.0.0')).toBe('- breaking change')
  })

  it('extracts a v-prefixed heading section', () => {
    expect(extractVersionSection(changelog, '1.2.3')).toBe('- fix things\n- add stuff')
  })

  it('extracts the last section up to the end of file', () => {
    expect(extractVersionSection(changelog, '1.0.0')).toBe('- initial release')
  })

  it('returns null when the version has no section', () => {
    expect(extractVersionSection(changelog, '9.9.9')).toBeNull()
  })

  it('escapes regex metacharacters — dots do not match arbitrary characters', () => {
    const tricky = '## 1x2x3\n\n- should not match\n'

    expect(extractVersionSection(tricky, '1.2.3')).toBeNull()
  })

  // [label, changelog, version, expected section]
  it.each([
    [
      '## 1.2.30 listed before ## 1.2.3',
      '## 1.2.30\n- thirty\n## 1.2.3\n- three',
      '1.2.3',
      '- three',
    ],
    [
      '## [1.2.30] listed before ## [1.2.3]',
      '## [1.2.30]\n- thirty\n## [1.2.3]\n- three',
      '1.2.3',
      '- three',
    ],
    [
      '## v1.2.30 listed before ## v1.2.3',
      '## v1.2.30\n- thirty\n## v1.2.3\n- three',
      '1.2.3',
      '- three',
    ],
    [
      '## [1.2.3-beta.1] listed before ## [1.2.3]',
      '## [1.2.3-beta.1]\n- beta\n## [1.2.3]\n- three',
      '1.2.3',
      '- three',
    ],
    [
      '## 1.2.3-beta.1 listed before ## 1.2.3',
      '## 1.2.3-beta.1\n- beta\n## 1.2.3\n- three',
      '1.2.3',
      '- three',
    ],
    [
      '## 1.2.3-beta.10 listed before ## 1.2.3-beta.1',
      '## 1.2.3-beta.10\n- ten\n## 1.2.3-beta.1\n- one',
      '1.2.3-beta.1',
      '- one',
    ],
    ['only a prerelease of the version', '## 1.2.3-beta.1\n- beta\n', '1.2.3', null],
    ['only a longer version', '## 1.2.30\n- thirty\n', '1.2.3', null],
  ])('matches the whole version, not a prefix: %s', (_label, text, version, expected) => {
    expect(extractVersionSection(text, version)).toBe(expected)
  })

  // [label, changelog, version, expected section]
  it.each([
    ['bare ## heading', '## 1.2.3\n- three\n', '1.2.3', '- three'],
    ['## v-prefixed heading', '## v1.2.3\n- three\n', '1.2.3', '- three'],
    [
      'Keep a Changelog: ## [1.2.3] - date',
      '## [1.2.3] - 2024-01-01\n- three\n',
      '1.2.3',
      '- three',
    ],
    ['## [v1.2.3]', '## [v1.2.3]\n- three\n', '1.2.3', '- three'],
    [
      '## [1.2.3](compare link) - date',
      '## [1.2.3](https://github.com/o/r/compare/v1.2.2...v1.2.3) - 2024-01-01\n- three\n',
      '1.2.3',
      '- three',
    ],
    [
      '## [1.2.3](compare link) (date)',
      '## [1.2.3](https://github.com/o/r/compare/v1.2.2...v1.2.3) (2024-01-01)\n- three\n',
      '1.2.3',
      '- three',
    ],
    [
      'heading with a tab after the version',
      '## 1.2.3\t(2024-01-01)\n- three\n',
      '1.2.3',
      '- three',
    ],
    ['# heading', '# 1.2.3\n- three\n', '1.2.3', '- three'],
    ['### heading', '### 1.2.3\n- three\n', '1.2.3', '- three'],
    ['#### heading is not a release heading', '#### 1.2.3\n- three\n', '1.2.3', null],
    ['version on the line after an empty heading', '##\n1.2.3\n- three\n', '1.2.3', null],
    ['heading naming the package, not supported', '## @scope/pkg@1.2.3\n- three\n', '1.2.3', null],
    [
      'Keep a Changelog: ### subsections stay in the section',
      '## [Unreleased]\n\n## [1.2.3] - 2024-01-02\n\n### Added\n\n- a\n\n### Fixed\n\n- b\n\n## [1.2.2] - 2024-01-01\n\n### Fixed\n\n- old\n',
      '1.2.3',
      '### Added\n\n- a\n\n### Fixed\n\n- b',
    ],
    [
      'changesets: ### Patch Changes stay in the section',
      '# @scope/pkg\n\n## 1.2.3\n\n### Patch Changes\n\n- abc123: fix\n\n## 1.2.2\n\n### Patch Changes\n\n- old\n',
      '1.2.3',
      '### Patch Changes\n\n- abc123: fix',
    ],
    [
      'conventional-changelog: a ## patch release ends at the next # release',
      '## [1.2.3](l) (d)\n\n### Bug Fixes\n\n* fix\n\n# [1.2.0](l) (d)\n\n### Features\n\n* older\n',
      '1.2.3',
      '### Bug Fixes\n\n* fix',
    ],
    [
      'conventional-changelog: a # minor release keeps its ### subsections',
      '# [1.3.0](l) (d)\n\n### Features\n\n* feat\n\n## [1.2.3](l) (d)\n\n* fix\n',
      '1.3.0',
      '### Features\n\n* feat',
    ],
    [
      'a # release keeps its ## subsections',
      '# 2.0.0\n\n## Breaking changes\n\n- dropped x\n\n# 1.0.0\n\n- first\n',
      '2.0.0',
      '## Breaking changes\n\n- dropped x',
    ],
    [
      'standard-version: a ### patch release keeps its ### subsections',
      '### [1.0.2](l) (d)\n\n### Bug Fixes\n\n* fix c\n\n### [1.0.1](l) (d)\n\n### Bug Fixes\n\n* fix b\n\n## [1.0.0](l) (d)\n\n* first\n',
      '1.0.2',
      '### Bug Fixes\n\n* fix c',
    ],
    [
      'standard-version: a ## release ends at the next ### release',
      '## [1.1.0](l) (d)\n\n### Features\n\n* feat\n\n### [1.0.1](l) (d)\n\n### Bug Fixes\n\n* fix\n',
      '1.1.0',
      '### Features\n\n* feat',
    ],
  ])('heading shape: %s', (_label, text, version, expected) => {
    expect(extractVersionSection(text, version)).toBe(expected)
  })

  it('returns null for an empty section body', () => {
    const empty = '## 1.0.0\n\n## 0.9.0\n\n- old\n'

    expect(extractVersionSection(empty, '1.0.0')).toBeNull()
  })

  it('finds a section in a CRLF changelog (Windows-authored repos)', () => {
    const crlf =
      '# Changelog\r\n\r\n## 1.0.0\r\n\r\n- fixed\r\n- added\r\n\r\n## 0.9.0\r\n\r\n- old\r\n'

    const section = extractVersionSection(crlf, '1.0.0')

    expect(section).not.toBeNull()
    // CR is carried through untouched here; the release-notes service normalizes it.
    expect(section!.replace(/\r/g, '')).toBe('- fixed\n- added')
    expect(extractVersionSection(crlf, '0.9.0')!.replace(/\r/g, '')).toBe('- old')
  })

  it('truncates sections longer than 100 lines', () => {
    const longBody = Array.from({ length: 150 }, (_, i) => `- entry ${i}`).join('\n')
    const long = `## 1.0.0\n${longBody}\n`

    const section = extractVersionSection(long, '1.0.0')

    expect(section).not.toBeNull()
    const lines = section!.split('\n')
    expect(lines).toHaveLength(101)
    expect(lines[100]).toBe('...')
    expect(lines[99]).toBe('- entry 99')
  })
})
