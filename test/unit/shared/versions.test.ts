import * as semver from 'semver'
import { describe, expect, it } from 'vitest'
import {
  applyVersionPrefix,
  buildRangeCandidates,
  findHighestPatchVersion,
  findRangeTargetVersion,
  highestOverallVersion,
  isBreakingUpdate,
  isSimpleVersionSpecifier,
  parseCurrentVersion,
  parseVersions,
  partitionVersionsByReleaseAge,
  toComparableVersion,
} from '../../../src/shared/versions'

describe('version utils', () => {
  describe('parseVersions()', () => {
    it('surfaces the latest version deprecation and engines from the packument', () => {
      const raw = JSON.stringify({
        versions: {
          '1.0.0': { engines: { node: '>=14' } },
          '2.0.0': { deprecated: 'use the scoped package', engines: { node: '>=18' } },
        },
      })

      const result = parseVersions(raw)
      expect(result.latestVersion).toBe('2.0.0')
      expect(result.deprecated).toBe('use the scoped package')
      expect(result.enginesNode).toBe('>=18')
    })

    it('leaves signals undefined when the latest version has none', () => {
      const raw = JSON.stringify({ versions: { '1.0.0': {}, '1.1.0': {} } })

      const result = parseVersions(raw)
      expect(result.latestVersion).toBe('1.1.0')
      expect(result.deprecated).toBeUndefined()
      expect(result.enginesNode).toBeUndefined()
      // The abbreviated packument has no `time` field.
      expect(result.publishTimes).toBeUndefined()
    })

    it('extracts publish times for tracked versions from a full packument', () => {
      const raw = JSON.stringify({
        versions: { '1.0.0': {}, '1.1.0': {} },
        time: {
          created: '2020-01-01T00:00:00.000Z',
          modified: '2024-01-02T00:00:00.000Z',
          '1.0.0': '2020-01-01T00:00:00.000Z',
          '1.1.0': '2024-01-02T00:00:00.000Z',
          '2.0.0-beta.1': '2024-06-01T00:00:00.000Z',
        },
      })

      const result = parseVersions(raw)
      // Only entries for versions in allVersions — no created/modified/prerelease keys.
      expect(result.publishTimes).toEqual({
        '1.0.0': '2020-01-01T00:00:00.000Z',
        '1.1.0': '2024-01-02T00:00:00.000Z',
      })
    })

    it('reports no publish times at all when no tracked version got a usable one', () => {
      // `time` was present but carried nothing we can use. An empty map would read as
      // "times available, nothing to hold" — the exact confusion the cooldown's
      // publishTimesAvailable diagnostic exists to prevent.
      const raw = JSON.stringify({
        versions: { '1.0.0': {}, '1.1.0': {} },
        time: { '1.0.0': 12345 },
      })

      expect(parseVersions(raw).publishTimes).toBeUndefined()
    })

    it('reports no publish times when `time` holds only created/modified', () => {
      const raw = JSON.stringify({
        versions: { '1.0.0': {} },
        time: { created: '2020-01-01T00:00:00.000Z', modified: '2024-01-01T00:00:00.000Z' },
      })

      expect(parseVersions(raw).publishTimes).toBeUndefined()
    })

    it('keeps prereleases out of allVersions but collects them separately, descending', () => {
      const raw = JSON.stringify({
        versions: {
          '0.19.5': {},
          '1.0.0-alpha.2': {},
          '1.0.0-beta.2': {},
          '1.0.0-beta.11': {},
          '1.0.0-rc.1': {},
          '1.0.0-rc.3': {},
          '16.0.0-preview.9': {},
          '16.0.0-preview.10': {},
        },
      })

      const result = parseVersions(raw)
      expect(result.allVersions).toEqual(['0.19.5'])
      expect(result.latestVersion).toBe('0.19.5')
      // Numeric identifiers compare numerically: beta.11 > beta.2, preview.10 > preview.9
      expect(result.prereleaseVersions).toEqual([
        '16.0.0-preview.10',
        '16.0.0-preview.9',
        '1.0.0-rc.3',
        '1.0.0-rc.1',
        '1.0.0-beta.11',
        '1.0.0-beta.2',
        '1.0.0-alpha.2',
      ])
    })

    it('excludes build-metadata versions from both lists', () => {
      const raw = JSON.stringify({
        versions: { '1.0.0': {}, '1.0.1+build.5': {}, '1.0.2-rc.1+build.6': {} },
      })

      const result = parseVersions(raw)
      expect(result.allVersions).toEqual(['1.0.0'])
      // 1.0.2-rc.1+build.6 is a valid prerelease — build metadata is ignored by semver
      expect(result.prereleaseVersions).toEqual(['1.0.2-rc.1+build.6'])
    })

    it('falls back to the highest prerelease for prerelease-only packages', () => {
      const raw = JSON.stringify({
        versions: {
          '1.0.0-beta.1': { engines: { node: '>=20' } },
          '1.0.0-rc.2': { deprecated: 'rc line abandoned', engines: { node: '>=22' } },
        },
      })

      const result = parseVersions(raw)
      expect(result.latestVersion).toBe('1.0.0-rc.2')
      expect(result.allVersions).toEqual([])
      // Health signals resolve against the prerelease latest too
      expect(result.deprecated).toBe('rc line abandoned')
      expect(result.enginesNode).toBe('>=22')
    })
  })

  describe('partitionVersionsByReleaseAge()', () => {
    const NOW = Date.parse('2026-07-06T12:00:00.000Z')
    const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString()

    it('withholds versions younger than the cooldown window, with their timestamps', () => {
      const times = {
        '1.0.0': minutesAgo(10_000),
        '1.1.0': minutesAgo(100),
        '1.2.0': minutesAgo(5),
      }

      const result = partitionVersionsByReleaseAge(['1.2.0', '1.1.0', '1.0.0'], times, 60, NOW)

      expect(result.eligible).toEqual(['1.1.0', '1.0.0'])
      // The timestamp travels with the withheld version so reporting never re-looks it up.
      expect(result.withheld).toEqual([{ version: '1.2.0', publishedAt: minutesAgo(5) }])
    })

    it('treats a version published exactly at the cutoff as eligible', () => {
      const times = { '1.0.0': minutesAgo(60) }

      const result = partitionVersionsByReleaseAge(['1.0.0'], times, 60, NOW)

      expect(result.eligible).toEqual(['1.0.0'])
      expect(result.withheld).toEqual([])
    })

    it('is a no-op when the registry exposes no publish times', () => {
      // Fail open: acting on absent evidence would hide every version.
      const result = partitionVersionsByReleaseAge(['1.0.0', '2.0.0'], undefined, 10_000, NOW)

      expect(result.eligible).toEqual(['1.0.0', '2.0.0'])
      expect(result.withheld).toEqual([])
    })

    it('keeps versions with a missing or unparsable timestamp eligible', () => {
      const times = { '1.0.0': 'not-a-date', '1.2.0': minutesAgo(5) }

      const result = partitionVersionsByReleaseAge(['1.2.0', '1.1.0', '1.0.0'], times, 60, NOW)

      expect(result.eligible).toEqual(['1.1.0', '1.0.0'])
      expect(result.withheld).toEqual([{ version: '1.2.0', publishedAt: minutesAgo(5) }])
    })

    it('keeps everything when the window is zero', () => {
      const times = { '1.0.0': minutesAgo(0) }

      const result = partitionVersionsByReleaseAge(['1.0.0'], times, 0, NOW)

      expect(result.eligible).toEqual(['1.0.0'])
      expect(result.withheld).toEqual([])
    })
  })

  describe('parseCurrentVersion()', () => {
    it('preserves prerelease tags on bare versions', () => {
      expect(parseCurrentVersion('1.0.0-beta.2')?.version).toBe('1.0.0-beta.2')
      expect(parseCurrentVersion('16.0.0-preview.9')?.version).toBe('16.0.0-preview.9')
    })

    it('preserves prerelease tags behind range prefixes (coerce would strip them)', () => {
      expect(parseCurrentVersion('^1.0.0-beta.2')?.version).toBe('1.0.0-beta.2')
      expect(parseCurrentVersion('~1.0.0-rc.3')?.version).toBe('1.0.0-rc.3')
    })

    it('resolves plain ranges to their minimum version', () => {
      expect(parseCurrentVersion('^1.2.0')?.version).toBe('1.2.0')
      expect(parseCurrentVersion('~2.5.3')?.version).toBe('2.5.3')
    })

    it('falls back to coerce for loose input and null for garbage', () => {
      expect(parseCurrentVersion('v2')?.version).toBe('2.0.0')
      expect(parseCurrentVersion('invalid')).toBeNull()
      expect(parseCurrentVersion('workspace:*')).toBeNull()
    })

    it('returns null for pure wildcards instead of resolving them to 0.0.0', () => {
      // minVersion('x') is 0.0.0 — resolving these would flag every wildcard
      // dep as outdated and write invalid specifiers like 'x2.5.1' on apply.
      expect(parseCurrentVersion('x')).toBeNull()
      expect(parseCurrentVersion('X')).toBeNull()
      expect(parseCurrentVersion('x.x')).toBeNull()
      expect(parseCurrentVersion('*')).toBeNull()
      expect(parseCurrentVersion('')).toBeNull()
      expect(parseCurrentVersion('  ')).toBeNull()
      // Partial wildcards still resolve like before
      expect(parseCurrentVersion('1.x')?.version).toBe('1.0.0')
    })
  })

  describe('isSimpleVersionSpecifier()', () => {
    it('accepts one full version behind ^, ~, >=, = or nothing', () => {
      for (const spec of [
        '1.2.3',
        '^1.2.3',
        '~1.2.3',
        '>=1.2.3',
        '=1.2.3',
        'v1.2.3',
        '^v1.2.3',
        '^1.0.0-beta.2',
        '~16.0.0-preview.9',
        '1.2.3+build.5',
      ]) {
        expect(isSimpleVersionSpecifier(spec), spec).toBe(true)
      }
    })

    it('rejects compound, hyphen, partial and x-ranges', () => {
      for (const spec of [
        '^17.0.0 || ^18.0.0',
        '^1.0.0||^2.0.0',
        '>=1.2.0 <2.0.0',
        '1.2.0 - 1.4.0',
        '1.x',
        '1.2',
        '^1',
        '~1.2',
        '*',
        'x',
        '',
      ]) {
        expect(isSimpleVersionSpecifier(spec), spec).toBe(false)
      }
    })

    it('rejects operators whose meaning a new version would change', () => {
      // '>2.0.0' excludes 2.0.0 itself; '<' and '<=' are ceilings, not floors.
      for (const spec of ['>1.2.3', '<2.0.0', '<=1.2.3', '~>1.2.3']) {
        expect(isSimpleVersionSpecifier(spec), spec).toBe(false)
      }
    })

    it('rejects tags, protocols, git refs and paths', () => {
      for (const spec of [
        'latest',
        'workspace:^1.2.3',
        'catalog:',
        'npm:real-pkg@^1.0.0',
        'patch:lodash@npm%3A4.17.21#./p.patch',
        'jsr:@std/fs@1.0.0',
        'portal:../x',
        'exec:./gen.js',
        'link:../x',
        'file:../x',
        'user/repo#v1.2.3',
        'github:user/repo#v1.2.3',
        'git+https://github.com/user/repo.git#v1.2.3',
        'ssh://git@github.com/user/repo.git#v1.2.3',
        'git@github.com:user/repo.git#v1.2.3',
        'https://example.com/pkg-1.2.3.tgz',
        '../pkg',
        './pkg',
      ]) {
        expect(isSimpleVersionSpecifier(spec), spec).toBe(false)
      }
    })

    it('rejects stray whitespace and invalid versions', () => {
      for (const spec of [' ^1.2.3', '^ 1.2.3', '1.2.3 ', '01.2.3', '1.2.3-']) {
        expect(isSimpleVersionSpecifier(spec), spec).toBe(false)
      }
    })
  })

  describe('buildRangeCandidates()', () => {
    const stable = ['1.1.0', '1.0.1', '1.0.0', '0.19.5']
    const prereleases = ['1.1.0-alpha.1', '1.0.0-rc.3', '1.0.0-beta.2', '1.0.0-alpha.2']

    it('returns the stable list untouched for a stable current version', () => {
      const current = parseCurrentVersion('^1.0.0')
      expect(buildRangeCandidates(current, stable, prereleases)).toBe(stable)
    })

    it('merges same-tuple prereleases for a prerelease current version, descending', () => {
      const current = parseCurrentVersion('^1.0.0-beta.2')
      expect(buildRangeCandidates(current, stable, prereleases)).toEqual([
        '1.1.0',
        '1.0.1',
        '1.0.0',
        '1.0.0-rc.3',
        '1.0.0-beta.2',
        '1.0.0-alpha.2',
        '0.19.5',
      ])
    })

    it('excludes prereleases from other tuples (^1.0.0-beta.2 never resolves 1.1.0-alpha.1)', () => {
      const current = parseCurrentVersion('1.0.0-beta.2')
      const result = buildRangeCandidates(current, stable, prereleases)
      expect(result).not.toContain('1.1.0-alpha.1')
    })

    it('handles a null current and missing prerelease list', () => {
      expect(buildRangeCandidates(null, stable, prereleases)).toBe(stable)
      expect(buildRangeCandidates(parseCurrentVersion('1.0.0-beta.2'), stable)).toBe(stable)
      expect(buildRangeCandidates(parseCurrentVersion('2.0.0-beta.1'), stable, prereleases)).toBe(
        stable
      )
    })
  })

  describe('highestOverallVersion()', () => {
    it('prefers the newer of the two list heads', () => {
      expect(highestOverallVersion(['0.19.5'], ['1.0.0-rc.3'])).toBe('1.0.0-rc.3')
      expect(highestOverallVersion(['1.0.0'], ['1.0.0-rc.3'])).toBe('1.0.0')
      expect(highestOverallVersion(['2.0.0'], ['1.0.0-rc.3'])).toBe('2.0.0')
    })

    it('handles one-sided and empty inputs', () => {
      expect(highestOverallVersion([], ['1.0.0-rc.3'])).toBe('1.0.0-rc.3')
      expect(highestOverallVersion(['1.0.0'])).toBe('1.0.0')
      expect(highestOverallVersion([], [])).toBeNull()
      expect(highestOverallVersion([])).toBeNull()
    })
  })

  describe('findRangeTargetVersion()', () => {
    const allVersions = [
      '1.0.0',
      '1.0.1',
      '1.0.2',
      '1.1.0',
      '1.2.0',
      '1.2.5',
      '2.0.0',
      '2.1.0',
      '3.0.0',
    ]

    it('should find the newest version in the same major', () => {
      const result = findRangeTargetVersion('1.0.0', allVersions)
      // The newest patch of the highest minor, even though 1.2.0 comes first in the list
      expect(result).toBe('1.2.5')
    })

    it('should find the newest version when multiple minors exist', () => {
      const result = findRangeTargetVersion('1.0.5', allVersions)
      expect(result).toBe('1.2.5')
    })

    it('should fallback to patch updates when no minor updates available', () => {
      const result = findRangeTargetVersion('1.2.0', allVersions)
      expect(result).toBe('1.2.5')
    })

    it('should return null when no updates available', () => {
      const result = findRangeTargetVersion('1.2.5', allVersions)
      expect(result).toBeNull()
    })

    it('should not cross major version boundaries', () => {
      const result = findRangeTargetVersion('1.5.0', allVersions)
      expect(result).toBeNull()
    })

    it('should handle version prefixes', () => {
      const result = findRangeTargetVersion('^1.0.0', allVersions)
      expect(result).toBe('1.2.5')
    })

    it('should handle invalid versions', () => {
      const result = findRangeTargetVersion('invalid', allVersions)
      expect(result).toBeNull()
    })

    it('should skip invalid versions in the array', () => {
      const versionsWithInvalid = ['1.0.0', 'invalid', '1.1.0', 'also-invalid', '1.2.0']
      const result = findRangeTargetVersion('1.0.0', versionsWithInvalid)
      // Returns highest minor version (1.2.0)
      expect(result).toBe('1.2.0')
    })

    it('should return null for empty allVersions array', () => {
      expect(findRangeTargetVersion('1.0.0', [])).toBeNull()
    })

    it('should pick the highest patch among multiple patch candidates', () => {
      // No minor bump available, 1.0.1, 1.0.2, 1.0.3 all qualify — should return 1.0.3
      expect(findRangeTargetVersion('1.0.0', ['1.0.1', '1.0.2', '1.0.3', '2.0.0'])).toBe('1.0.3')
    })

    it('should prefer a minor bump over an available patch update', () => {
      // Both 1.0.5 (patch) and 1.1.0 (minor) are available — minor wins
      expect(findRangeTargetVersion('1.0.0', ['1.0.5', '1.1.0', '2.0.0'])).toBe('1.1.0')
    })

    it('should not return a lower version when already on latest within major', () => {
      expect(findRangeTargetVersion('1.2.5', ['1.0.0', '1.2.3', '2.0.0'])).toBeNull()
    })

    it('offers a newer same-tuple prerelease to a prerelease install', () => {
      expect(findRangeTargetVersion('1.0.0-beta.2', ['1.0.0-rc.3', '1.0.0-beta.2', '0.19.5'])).toBe(
        '1.0.0-rc.3'
      )
      expect(
        findRangeTargetVersion('^16.0.0-preview.9', ['16.0.0-preview.10', '16.0.0-preview.9'])
      ).toBe('16.0.0-preview.10')
    })

    it('prefers the stable release over a prerelease of the same tuple', () => {
      expect(findRangeTargetVersion('1.0.0-beta.2', ['1.0.0', '1.0.0-rc.3', '1.0.0-beta.2'])).toBe(
        '1.0.0'
      )
    })

    it('prefers a stable minor bump over a same-tuple prerelease', () => {
      expect(findRangeTargetVersion('1.0.0-beta.2', ['1.1.0', '1.0.0-rc.3', '1.0.0-beta.2'])).toBe(
        '1.1.0'
      )
    })

    it('returns null when the prerelease install is already the newest candidate', () => {
      expect(findRangeTargetVersion('1.0.0-rc.3', ['1.0.0-rc.3', '1.0.0-beta.2'])).toBeNull()
    })

    it('never offers a prerelease to a stable install, even if one leaks into the list', () => {
      expect(findRangeTargetVersion('1.0.0', ['1.1.0-beta.1', '1.0.0'])).toBeNull()
      expect(findRangeTargetVersion('1.0.0', ['1.0.1-rc.1', '1.0.0'])).toBeNull()
      expect(findRangeTargetVersion('1.0.0', ['1.1.0-beta.1', '1.0.5', '1.0.0'])).toBe('1.0.5')
    })
  })

  describe('range target follows the specifier operator', () => {
    // Every case runs against the pool both ascending and descending: the search must
    // not depend on the order the candidates arrive in.
    const STABLE = [
      '0.0.3',
      '0.0.5',
      '0.2.3',
      '0.2.9',
      '0.3.0',
      '0.9.1',
      '1.2.3',
      '1.2.9',
      '1.3.0',
      '1.9.0',
      '2.0.0',
    ]
    const orders = (versions: string[]) => [
      [...versions].sort(semver.compare),
      [...versions].sort(semver.rcompare),
    ]

    it.each([
      // ^ with major >= 1: newest in the same major
      ['^1.2.3', '1.9.0'],
      ['^v1.2.3', '1.9.0'],
      ['^1.9.0', null],
      // ^0.y.z: newest in the same 0.y minor — a new 0.y is breaking
      ['^0.2.3', '0.2.9'],
      ['^0.2.9', null],
      // ^0.0.z: nothing is in range beyond itself
      ['^0.0.3', null],
      // ~: newest in the same major.minor
      ['~1.2.3', '1.2.9'],
      ['~v1.2.3', '1.2.9'],
      ['~0.2.3', '0.2.9'],
      ['~0.0.3', '0.0.5'],
      ['~1.2.9', null],
      // exact pins and >=: newest in the same major (the "minor" target for pinned projects)
      ['1.2.3', '1.9.0'],
      ['=1.2.3', '1.9.0'],
      ['v1.2.3', '1.9.0'],
      ['>=1.2.3', '1.9.0'],
      ['0.2.3', '0.9.1'],
      ['>=0.2.3', '0.9.1'],
      ['1.9.0', null],
    ])('%s → %s', (specifier, expected) => {
      for (const pool of orders(STABLE)) {
        expect(findRangeTargetVersion(specifier, pool)).toBe(expected)
      }
    })

    it.each([
      // Candidate pools shaped like buildRangeCandidates output: stable + same-tuple prereleases.
      ['^1.0.0-beta.2', ['1.0.0-beta.2', '1.0.0-rc.3', '1.0.0', '1.4.0', '2.0.0'], '1.4.0'],
      ['^1.0.0-beta.2', ['1.0.0-beta.2', '1.0.0-rc.3', '0.19.5'], '1.0.0-rc.3'],
      ['~1.0.0-beta.2', ['1.0.0-beta.2', '1.0.0-rc.3', '1.0.0', '1.4.0', '2.0.0'], '1.0.0'],
      ['^0.2.0-beta.1', ['0.2.0-beta.1', '0.2.0-rc.1', '0.2.0', '0.2.5', '0.3.0'], '0.2.5'],
      ['^0.0.3-beta.1', ['0.0.3-beta.1', '0.0.3-rc.1', '0.0.3', '0.0.4'], '0.0.3'],
      ['1.0.0-beta.2', ['1.0.0-beta.2', '1.0.0-rc.3', '1.4.0', '2.0.0'], '1.4.0'],
      ['>=1.0.0-beta.2', ['1.0.0-beta.2', '1.0.0-rc.3', '1.4.0', '2.0.0'], '1.4.0'],
    ])('%s over %j → %s (prerelease install)', (specifier, candidates, expected) => {
      for (const pool of orders(candidates)) {
        expect(findRangeTargetVersion(specifier, pool)).toBe(expected)
      }
    })

    it('returns the newest candidate regardless of input order', () => {
      const ascending = ['1.1.0', '1.2.0', '1.2.1', '1.2.9']
      expect(findRangeTargetVersion('^1.1.0', ascending)).toBe('1.2.9')
      expect(findRangeTargetVersion('^1.1.0', [...ascending].reverse())).toBe('1.2.9')
    })
  })

  describe('isBreakingUpdate()', () => {
    it.each([
      ['1.2.3', '2.0.0', true],
      ['1.2.3', '2.0.0-alpha.1', true],
      ['1.2.3', '1.9.0', false],
      ['0.2.3', '1.0.0', true],
      ['0.2.3', '0.3.0', true],
      ['0.2.3', '0.2.9', false],
      ['0.0.3', '0.0.4', true],
      ['0.0.3', '0.0.3', false],
      ['1.0.0-beta.2', '1.1.0-alpha.1', false],
      ['0.2.0-beta.1', '0.3.0-alpha.1', true],
    ] as const)('%s → %s: %s', (installed, version, expected) => {
      expect(isBreakingUpdate(semver.parse(installed) as semver.SemVer, version)).toBe(expected)
    })
  })

  describe('findHighestPatchVersion()', () => {
    it('stays inside a ^0.0.z range, which allows no newer patch', () => {
      expect(findHighestPatchVersion('^0.0.3', ['0.0.5', '0.0.4', '0.0.3'])).toBeNull()
      expect(findHighestPatchVersion('~0.0.3', ['0.0.5', '0.0.4', '0.0.3'])).toBe('0.0.5')
      expect(findHighestPatchVersion('0.0.3', ['0.0.5', '0.0.4', '0.0.3'])).toBe('0.0.5')
      expect(findHighestPatchVersion('^0.0.3-beta.1', ['0.0.4', '0.0.3', '0.0.3-rc.1'])).toBe(
        '0.0.3'
      )
    })

    it('returns the highest patch in the same major.minor line', () => {
      expect(findHighestPatchVersion('1.0.0', ['1.0.1', '1.0.2', '1.0.3', '2.0.0'])).toBe('1.0.3')
    })

    it('is order-independent when versions arrive descending', () => {
      expect(findHighestPatchVersion('1.0.0', ['1.0.3', '1.0.1', '1.0.2'])).toBe('1.0.3')
    })

    it('never crosses a minor or major boundary', () => {
      // Only minor/major updates exist — a patch policy must not take them.
      expect(findHighestPatchVersion('1.0.2', ['1.0.0', '1.1.0', '1.2.5', '2.0.0'])).toBeNull()
    })

    it('handles range prefixes on the installed version', () => {
      expect(findHighestPatchVersion('^1.0.0', ['1.0.1', '1.1.0'])).toBe('1.0.1')
    })

    it('returns null for an uncoercible installed version', () => {
      expect(findHighestPatchVersion('invalid', ['1.0.1'])).toBeNull()
    })

    it('skips invalid versions in the array', () => {
      expect(findHighestPatchVersion('1.0.0', ['not-a-version', '1.0.2'])).toBe('1.0.2')
    })

    it('returns null for an empty array', () => {
      expect(findHighestPatchVersion('1.0.0', [])).toBeNull()
    })

    it('ranks prereleases natively for a prerelease install (beta < rc < final)', () => {
      expect(findHighestPatchVersion('1.0.0-beta.2', ['1.0.0-rc.3', '1.0.0-beta.2'])).toBe(
        '1.0.0-rc.3'
      )
      expect(findHighestPatchVersion('1.0.0-beta.2', ['1.0.0', '1.0.0-rc.3'])).toBe('1.0.0')
      expect(
        findHighestPatchVersion('16.0.0-preview.9', ['16.0.0-preview.10', '16.0.0-preview.9'])
      ).toBe('16.0.0-preview.10')
    })

    it('does not offer an older or equal prerelease', () => {
      expect(findHighestPatchVersion('1.0.0-rc.3', ['1.0.0-rc.3', '1.0.0-beta.2'])).toBeNull()
    })

    it('never offers a prerelease to a stable install', () => {
      expect(findHighestPatchVersion('1.0.0', ['1.0.1-rc.1', '1.0.0'])).toBeNull()
      expect(findHighestPatchVersion('1.0.0', ['1.0.1-rc.1', '1.0.1'])).toBe('1.0.1')
    })
  })
})

describe('version identity helpers', () => {
  it('toComparableVersion normalizes valid and coercible versions', () => {
    expect(toComparableVersion('1.2.3')).toBe('1.2.3')
    expect(toComparableVersion('^1.2.3')).toBe('1.2.3')
    expect(toComparableVersion('v2')).toBe('2.0.0')
  })

  it('toComparableVersion returns null for garbage', () => {
    expect(toComparableVersion('workspace:*')).toBeNull()
  })
})

describe('invalid version tolerance', () => {
  it('findRangeTargetVersion skips invalid versions in the patch fallback pass', () => {
    expect(findRangeTargetVersion('1.0.0', ['garbage', '1.0.5'])).toBe('1.0.5')
  })

  it('parseVersions handles a packument without a versions field', () => {
    const result = parseVersions('{}')
    expect(result.latestVersion).toBe('unknown')
    expect(result.allVersions).toEqual([])
  })

  it('findRangeTargetVersion keeps the highest patch when candidates arrive out of order', () => {
    expect(findRangeTargetVersion('1.0.0', ['1.0.5', '1.0.3'])).toBe('1.0.5')
  })

  it('applyVersionPrefix leaves an unprefixed specifier bare', () => {
    expect(applyVersionPrefix('1.2.3', '2.0.0')).toBe('2.0.0')
    expect(applyVersionPrefix('^1.2.3', '2.0.0')).toBe('^2.0.0')
  })
})
