import { describe, expect, it } from 'vitest'
import {
  applyVersionPrefix,
  extractMajorVersion,
  findClosestMinorVersion,
  findHighestPatchVersion,
  getOptimizedRangeVersion,
  isVersionOutdated,
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

    it('should handle prereleases', () => {
      // semver.coerce removes prerelease tags, so 1.0.0-beta.1 becomes 1.0.0
      // When both are coerced to 1.0.0, they're equal, so it returns false
      expect(isVersionOutdated('1.0.0-beta.1', '1.0.0')).toBe(false)
      expect(isVersionOutdated('1.0.0-alpha.1', '1.0.0-beta.1')).toBe(false)
      // But this should work
      expect(isVersionOutdated('1.0.0-beta.1', '2.0.0')).toBe(true)
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
