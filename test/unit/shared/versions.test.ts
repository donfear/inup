import { describe, expect, it } from 'vitest'
import {
  applyVersionPrefix,
  buildRangeCandidates,
  extractMajorVersion,
  findClosestMinorVersion,
  findHighestPatchVersion,
  getOptimizedRangeVersion,
  highestOverallVersion,
  isPrereleaseCurrent,
  isVersionOutdated,
  parseCurrentVersion,
  parseVersions,
  toComparableVersion,
  versionIdentity,
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
  })

  describe('isPrereleaseCurrent()', () => {
    it('detects prerelease specifiers regardless of tag name', () => {
      expect(isPrereleaseCurrent('1.0.0-alpha.1')).toBe(true)
      expect(isPrereleaseCurrent('^1.0.0-beta.2')).toBe(true)
      expect(isPrereleaseCurrent('~1.0.0-rc.3')).toBe(true)
      expect(isPrereleaseCurrent('16.0.0-preview.9')).toBe(true)
      expect(isPrereleaseCurrent('2.0.0-canary.20260729')).toBe(true)
    })

    it('is false for stable and unparseable specifiers', () => {
      expect(isPrereleaseCurrent('1.0.0')).toBe(false)
      expect(isPrereleaseCurrent('^1.2.0')).toBe(false)
      expect(isPrereleaseCurrent('workspace:*')).toBe(false)
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

  describe('isVersionOutdated()', () => {
    it('should return true when latest is greater than current', () => {
      expect(isVersionOutdated('1.0.0', '2.0.0')).toBe(true)
      expect(isVersionOutdated('1.5.0', '1.6.0')).toBe(true)
      expect(isVersionOutdated('1.0.1', '1.0.2')).toBe(true)
    })

    it('should return false when versions are equal', () => {
      expect(isVersionOutdated('1.0.0', '1.0.0')).toBe(false)
      expect(isVersionOutdated('2.5.3', '2.5.3')).toBe(false)
    })

    it('should return false when current is newer than latest', () => {
      expect(isVersionOutdated('2.0.0', '1.0.0')).toBe(false)
      expect(isVersionOutdated('1.6.0', '1.5.0')).toBe(false)
    })

    it('should handle version prefixes correctly', () => {
      expect(isVersionOutdated('^1.0.0', '2.0.0')).toBe(true)
      expect(isVersionOutdated('~1.5.0', '1.6.0')).toBe(true)
      expect(isVersionOutdated('>=1.0.0', '1.0.1')).toBe(true)
    })

    it('should handle invalid versions gracefully', () => {
      expect(isVersionOutdated('invalid', '1.0.0')).toBe(false)
      expect(isVersionOutdated('1.0.0', 'invalid')).toBe(false)
      expect(isVersionOutdated('invalid', 'invalid')).toBe(false)
    })

    it('should handle prereleases with native semver ordering', () => {
      // alpha < beta < rc < preview-style tags < the final release
      expect(isVersionOutdated('1.0.0-beta.1', '1.0.0')).toBe(true)
      expect(isVersionOutdated('1.0.0-alpha.1', '1.0.0-beta.1')).toBe(true)
      expect(isVersionOutdated('1.0.0-beta.2', '1.0.0-rc.3')).toBe(true)
      expect(isVersionOutdated('16.0.0-preview.9', '16.0.0-preview.10')).toBe(true)
      expect(isVersionOutdated('1.0.0-beta.1', '2.0.0')).toBe(true)
      // Newer or equal prereleases are not outdated
      expect(isVersionOutdated('1.0.0-rc.1', '1.0.0-beta.2')).toBe(false)
      expect(isVersionOutdated('1.0.0-rc.3', '1.0.0-rc.3')).toBe(false)
      // Range prefixes keep the prerelease tag (coerce used to strip it)
      expect(isVersionOutdated('^1.0.0-beta.2', '1.0.0-rc.3')).toBe(true)
    })
  })

  describe('getOptimizedRangeVersion()', () => {
    const allVersions = ['1.0.0', '1.1.0', '1.2.0', '2.0.0', '2.1.0', '3.0.0']

    it('should return highest version satisfying the range', () => {
      const result = getOptimizedRangeVersion('test-package', '^1.0.0', allVersions, '3.0.0')
      expect(result).toBe('1.2.0')
    })

    it('should return highest version for tilde range', () => {
      const result = getOptimizedRangeVersion('test-package', '~1.1.0', allVersions, '3.0.0')
      expect(result).toBe('1.1.0')
    })

    it('should return latest when no versions satisfy the range', () => {
      const result = getOptimizedRangeVersion('test-package', '^4.0.0', allVersions, '3.0.0')
      expect(result).toBe('3.0.0')
    })

    it('should handle exact version ranges', () => {
      const result = getOptimizedRangeVersion('test-package', '2.0.0', allVersions, '3.0.0')
      expect(result).toBe('2.0.0')
    })

    it('should handle >= ranges', () => {
      const result = getOptimizedRangeVersion('test-package', '>=2.0.0', allVersions, '3.0.0')
      expect(result).toBe('3.0.0')
    })

    it('should fallback to latest on invalid range', () => {
      const result = getOptimizedRangeVersion('test-package', 'invalid', allVersions, '3.0.0')
      expect(result).toBe('3.0.0')
    })
  })

  describe('findClosestMinorVersion()', () => {
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

    it('should find highest minor version in same major', () => {
      const result = findClosestMinorVersion('1.0.0', allVersions)
      // Returns the first version with highest minor number (1.2.0)
      expect(result).toBe('1.2.0')
    })

    it('should find highest minor version when multiple exist', () => {
      const result = findClosestMinorVersion('1.0.5', allVersions)
      // Returns the first version with highest minor number (1.2.0)
      expect(result).toBe('1.2.0')
    })

    it('should fallback to patch updates when no minor updates available', () => {
      const result = findClosestMinorVersion('1.2.0', allVersions)
      expect(result).toBe('1.2.5')
    })

    it('should return null when no updates available', () => {
      const result = findClosestMinorVersion('1.2.5', allVersions)
      expect(result).toBeNull()
    })

    it('should not cross major version boundaries', () => {
      const result = findClosestMinorVersion('1.5.0', allVersions)
      expect(result).toBeNull()
    })

    it('should handle version prefixes', () => {
      const result = findClosestMinorVersion('^1.0.0', allVersions)
      // coerce will convert ^1.0.0 to 1.0.0, then find first version with highest minor
      expect(result).toBe('1.2.0')
    })

    it('should handle invalid versions', () => {
      const result = findClosestMinorVersion('invalid', allVersions)
      expect(result).toBeNull()
    })

    it('should skip invalid versions in the array', () => {
      const versionsWithInvalid = ['1.0.0', 'invalid', '1.1.0', 'also-invalid', '1.2.0']
      const result = findClosestMinorVersion('1.0.0', versionsWithInvalid)
      // Returns highest minor version (1.2.0)
      expect(result).toBe('1.2.0')
    })

    it('should return null for empty allVersions array', () => {
      expect(findClosestMinorVersion('1.0.0', [])).toBeNull()
    })

    it('should pick the highest patch among multiple patch candidates', () => {
      // No minor bump available, 1.0.1, 1.0.2, 1.0.3 all qualify — should return 1.0.3
      expect(findClosestMinorVersion('1.0.0', ['1.0.1', '1.0.2', '1.0.3', '2.0.0'])).toBe('1.0.3')
    })

    it('should prefer a minor bump over an available patch update', () => {
      // Both 1.0.5 (patch) and 1.1.0 (minor) are available — minor wins
      expect(findClosestMinorVersion('1.0.0', ['1.0.5', '1.1.0', '2.0.0'])).toBe('1.1.0')
    })

    it('should not return a lower version when already on latest within major', () => {
      expect(findClosestMinorVersion('1.2.5', ['1.0.0', '1.2.3', '2.0.0'])).toBeNull()
    })

    it('offers a newer same-tuple prerelease to a prerelease install', () => {
      expect(
        findClosestMinorVersion('1.0.0-beta.2', ['1.0.0-rc.3', '1.0.0-beta.2', '0.19.5'])
      ).toBe('1.0.0-rc.3')
      expect(
        findClosestMinorVersion('^16.0.0-preview.9', ['16.0.0-preview.10', '16.0.0-preview.9'])
      ).toBe('16.0.0-preview.10')
    })

    it('prefers the stable release over a prerelease of the same tuple', () => {
      expect(findClosestMinorVersion('1.0.0-beta.2', ['1.0.0', '1.0.0-rc.3', '1.0.0-beta.2'])).toBe(
        '1.0.0'
      )
    })

    it('prefers a stable minor bump over a same-tuple prerelease', () => {
      expect(findClosestMinorVersion('1.0.0-beta.2', ['1.1.0', '1.0.0-rc.3', '1.0.0-beta.2'])).toBe(
        '1.1.0'
      )
    })

    it('returns null when the prerelease install is already the newest candidate', () => {
      expect(findClosestMinorVersion('1.0.0-rc.3', ['1.0.0-rc.3', '1.0.0-beta.2'])).toBeNull()
    })

    it('never offers a prerelease to a stable install, even if one leaks into the list', () => {
      expect(findClosestMinorVersion('1.0.0', ['1.1.0-beta.1', '1.0.0'])).toBeNull()
      expect(findClosestMinorVersion('1.0.0', ['1.0.1-rc.1', '1.0.0'])).toBeNull()
      expect(findClosestMinorVersion('1.0.0', ['1.1.0-beta.1', '1.0.5', '1.0.0'])).toBe('1.0.5')
    })
  })

  describe('findHighestPatchVersion()', () => {
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
  it('extractMajorVersion pulls the major from loose specifiers', () => {
    expect(extractMajorVersion('^2.1.0')).toBe('2')
    expect(extractMajorVersion('v3')).toBe('3')
  })

  it('extractMajorVersion returns null for unusable input', () => {
    expect(extractMajorVersion('')).toBeNull()
    expect(extractMajorVersion('not-a-version')).toBeNull()
  })

  it('toComparableVersion normalizes valid and coercible versions', () => {
    expect(toComparableVersion('1.2.3')).toBe('1.2.3')
    expect(toComparableVersion('^1.2.3')).toBe('1.2.3')
    expect(toComparableVersion('v2')).toBe('2.0.0')
  })

  it('toComparableVersion returns null for garbage', () => {
    expect(toComparableVersion('workspace:*')).toBeNull()
  })

  it('versionIdentity falls back to a raw marker for non-semver input', () => {
    expect(versionIdentity('1.2.3')).toBe('1.2.3')
    expect(versionIdentity('^1.2.3')).toBe('1.2.3')
    expect(versionIdentity('workspace:*')).toBe('raw:workspace:*')
  })
})

describe('invalid version tolerance', () => {
  it('getOptimizedRangeVersion skips versions that crash the range check', () => {
    expect(getOptimizedRangeVersion('pkg', '^1.0.0', ['garbage', '1.2.0'], '2.0.0')).toBe('1.2.0')
  })

  it('findClosestMinorVersion skips invalid versions in the patch fallback pass', () => {
    expect(findClosestMinorVersion('1.0.0', ['garbage', '1.0.5'])).toBe('1.0.5')
  })

  it('parseVersions handles a packument without a versions field', () => {
    const result = parseVersions('{}')
    expect(result.latestVersion).toBe('unknown')
    expect(result.allVersions).toEqual([])
  })

  it('getOptimizedRangeVersion treats an invalid range as unsatisfiable', () => {
    expect(getOptimizedRangeVersion('pkg', 'not-a-range!!!', ['1.0.0', '1.1.0'], '9.9.9')).toBe(
      '9.9.9'
    )
  })

  it('getOptimizedRangeVersion falls back to latest when the version list is broken', () => {
    expect(getOptimizedRangeVersion('pkg', '^1.0.0', null as unknown as string[], '9.9.9')).toBe(
      '9.9.9'
    )
  })

  it('findClosestMinorVersion keeps the highest patch when candidates arrive out of order', () => {
    expect(findClosestMinorVersion('1.0.0', ['1.0.5', '1.0.3'])).toBe('1.0.5')
  })

  it('findClosestMinorVersion returns null when the version list is broken', () => {
    expect(findClosestMinorVersion('1.0.0', null as unknown as string[])).toBeNull()
  })

  it('applyVersionPrefix leaves an unprefixed specifier bare', () => {
    expect(applyVersionPrefix('1.2.3', '2.0.0')).toBe('2.0.0')
    expect(applyVersionPrefix('^1.2.3', '2.0.0')).toBe('^2.0.0')
  })
})
