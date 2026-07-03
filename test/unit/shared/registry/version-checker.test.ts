import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execSync } from 'child_process'
import {
  checkForUpdate,
  checkForUpdateAsync,
} from '../../../../src/shared/registry/version-checker'
import { PACKAGE_NAME } from '../../../../src/shared/config/constants'

// `npm view` is mocked so this suite is deterministic and offline-safe.
vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>()
  return { ...original, execSync: vi.fn() }
})

const execMock = vi.mocked(execSync)
const originalArgv1 = process.argv[1]

beforeEach(() => {
  execMock.mockReset()
  execMock.mockReturnValue('2.0.0\n')
})

afterEach(() => {
  process.argv[1] = originalArgv1
})

describe('checkForUpdate', () => {
  it('queries the registry via npm view', async () => {
    await checkForUpdate(PACKAGE_NAME, '1.0.0')

    expect(execMock).toHaveBeenCalledWith(
      `npm view ${PACKAGE_NAME} version`,
      expect.objectContaining({ encoding: 'utf-8' })
    )
  })

  it('flags older versions as outdated', async () => {
    const result = await checkForUpdate(PACKAGE_NAME, '1.0.0')

    expect(result).toEqual({
      currentVersion: '1.0.0',
      latestVersion: '2.0.0',
      isOutdated: true,
      updateCommand: expect.stringContaining(PACKAGE_NAME),
    })
  })

  it('accepts the latest version as current', async () => {
    const result = await checkForUpdate(PACKAGE_NAME, '2.0.0')

    expect(result?.isOutdated).toBe(false)
  })

  it('accepts versions newer than the registry (pre-release installs)', async () => {
    const result = await checkForUpdate(PACKAGE_NAME, '3.0.0')

    expect(result?.isOutdated).toBe(false)
  })

  it('suggests npx when running via npx', async () => {
    process.argv[1] = '/home/user/.npm/_npx/123/node_modules/.bin/inup'

    const result = await checkForUpdate(PACKAGE_NAME, '1.0.0')

    expect(result?.updateCommand).toBe(`npx ${PACKAGE_NAME}@latest`)
  })

  it('suggests a global install otherwise', async () => {
    process.argv[1] = '/usr/local/bin/inup'

    const result = await checkForUpdate(PACKAGE_NAME, '1.0.0')

    expect(result?.updateCommand).toBe(`npm install -g ${PACKAGE_NAME}@latest`)
  })

  it('fails silently when npm is unavailable', async () => {
    execMock.mockImplementation(() => {
      throw new Error('npm not found')
    })

    expect(await checkForUpdate(PACKAGE_NAME, '1.0.0')).toBeNull()
  })

  it('fails silently on unparseable registry output', async () => {
    execMock.mockReturnValue('not-a-version\n')

    expect(await checkForUpdate(PACKAGE_NAME, '1.0.0')).toBeNull()
  })
})

describe('checkForUpdateAsync', () => {
  it('resolves with the update result', async () => {
    const result = await checkForUpdateAsync(PACKAGE_NAME, '1.0.0')

    expect(result?.latestVersion).toBe('2.0.0')
    expect(result?.isOutdated).toBe(true)
  })

  it('resolves null instead of rejecting on failure', async () => {
    execMock.mockImplementation(() => {
      throw new Error('offline')
    })

    await expect(checkForUpdateAsync(PACKAGE_NAME, '1.0.0')).resolves.toBeNull()
  })
})
