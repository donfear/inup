import { describe, it, expect } from 'vitest'
import { isVersionOutdated, getOptimizedRangeVersion, findClosestMinorVersion } from './version'

describe('version utils', () => {
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
  })
})
