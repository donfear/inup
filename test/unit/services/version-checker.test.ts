import { describe, it, expect } from 'vitest'
import { checkForUpdate, checkForUpdateAsync } from '../../../src/services/version-checker'
import { PACKAGE_NAME } from '../../../src/config/constants'

describe('version-checker', () => {
  describe('checkForUpdate()', () => {
    it(`should check for updates for ${PACKAGE_NAME}`, async () => {
      const result = await checkForUpdate(PACKAGE_NAME, '1.0.0')

      expect(result).not.toBeNull()
      expect(result?.currentVersion).toBe('1.0.0')
      expect(result?.latestVersion).toMatch(/^\d+\.\d+\.\d+$/)
      expect(result?.updateCommand).toBeTruthy()
    }, 30000)

    it('should detect up-to-date version', async () => {
      // Use a very high version that likely doesn't exist yet
      const result = await checkForUpdate(PACKAGE_NAME, '999.999.999')

      expect(result).not.toBeNull()
      expect(result?.isOutdated).toBe(false)
    }, 10000)

    it('should have update command', async () => {
      const result = await checkForUpdate(PACKAGE_NAME, '1.0.0')

      expect(result).not.toBeNull()
      // Should contain either npm install or npx
      expect(result?.updateCommand).toMatch(/(npm install|npx)/)
      expect(result?.updateCommand).toContain(PACKAGE_NAME)
    }, 10000)
  })

  describe('checkForUpdateAsync()', () => {
    it(`should check for updates asynchronously for ${PACKAGE_NAME}`, async () => {
      const result = await checkForUpdateAsync(PACKAGE_NAME, '1.0.0')

      expect(result).not.toBeNull()
      expect(result?.currentVersion).toBe('1.0.0')
      expect(result?.latestVersion).toMatch(/^\d+\.\d+\.\d+$/)
    }, 10000)

    it('should timeout properly', async () => {
      const startTime = Date.now()
      const result = await checkForUpdateAsync(PACKAGE_NAME, '1.0.0')
      const duration = Date.now() - startTime

      // Should complete within reasonable time (not hang)
      expect(duration).toBeLessThan(10000)
      expect(result).toBeDefined()
    }, 15000)
  })
})
