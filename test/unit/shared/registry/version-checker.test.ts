import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkForUpdate,
  checkForUpdateAsync,
} from '../../../../src/shared/registry/version-checker'
import { NPM_REGISTRY_URL, PACKAGE_NAME } from '../../../../src/shared/config/constants'

// The registry request is mocked so this suite is deterministic and offline-safe.
const fetchMock = vi.fn()

const versionResponse = (version: unknown, ok = true) => ({
  ok,
  json: async () => ({ version }),
})

const originalArgv1 = process.argv[1]

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(versionResponse('2.0.0'))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  process.argv[1] = originalArgv1
  vi.unstubAllGlobals()
})

describe('checkForUpdate', () => {
  it('queries the registry latest endpoint directly (no npm spawn)', async () => {
    await checkForUpdate(PACKAGE_NAME, '1.0.0')

    expect(fetchMock).toHaveBeenCalledWith(
      `${NPM_REGISTRY_URL}/${PACKAGE_NAME}/latest`,
      expect.objectContaining({ method: 'GET' })
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

  it('fails silently when the registry is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    expect(await checkForUpdate(PACKAGE_NAME, '1.0.0')).toBeNull()
  })

  it('fails silently on non-2xx responses', async () => {
    fetchMock.mockResolvedValue(versionResponse(undefined, false))

    expect(await checkForUpdate(PACKAGE_NAME, '1.0.0')).toBeNull()
  })

  it('fails silently on unparseable registry output', async () => {
    fetchMock.mockResolvedValue(versionResponse('not-a-version'))

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
    fetchMock.mockRejectedValue(new Error('offline'))

    await expect(checkForUpdateAsync(PACKAGE_NAME, '1.0.0')).resolves.toBeNull()
  })
})
