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

  it('returns null for an empty section body', () => {
    const empty = '## 1.0.0\n\n## 0.9.0\n\n- old\n'

    expect(extractVersionSection(empty, '1.0.0')).toBeNull()
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
