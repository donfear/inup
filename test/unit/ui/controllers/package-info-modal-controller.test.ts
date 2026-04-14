import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchPackageMetadata: vi.fn(),
  getVersionsBetween: vi.fn().mockReturnValue([]),
  fetchReleaseNotesForVersion: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../../../src/services', () => ({
  changelogFetcher: {
    fetchPackageMetadata: mocks.fetchPackageMetadata,
    getVersionsBetween: mocks.getVersionsBetween,
    fetchReleaseNotesForVersion: mocks.fetchReleaseNotesForVersion,
  },
}))

import { PackageInfoModalController } from '../../../../src/ui/controllers'
import { PackageSelectionState } from '../../../../src/types'

const baseState: PackageSelectionState = {
  name: 'next',
  packageJsonPath: '/repo/package.json',
  packageJsonPaths: ['/repo/package.json'],
  currentVersionSpecifier: '^16.1.6',
  currentVersion: '16.1.6',
  rangeVersion: '16.2.0',
  latestVersion: '16.2.3',
  selectedOption: 'range',
  loadState: 'ready',
  hasRangeUpdate: true,
  hasMajorUpdate: true,
  type: 'dependencies',
  vulnerability: {
    count: 1,
    highestSeverity: 'high',
    detailsUrl: 'https://github.com/advisories/GHSA-1',
    advisories: [
      {
        id: 1,
        title: 'Security issue',
        severity: 'high',
        url: 'https://github.com/advisories/GHSA-1',
      },
    ],
  },
}

describe('PackageInfoModalController', () => {
  beforeEach(() => {
    mocks.fetchPackageMetadata.mockReset()
    mocks.getVersionsBetween.mockReset()
    mocks.fetchReleaseNotesForVersion.mockReset()
    mocks.getVersionsBetween.mockReturnValue([])
    mocks.fetchReleaseNotesForVersion.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('hydrates package info without mutating vulnerability links', async () => {
    mocks.fetchPackageMetadata.mockResolvedValue({
      description: 'Framework',
      homepage: 'https://nextjs.org',
      releaseNotes: 'https://github.com/vercel/next.js/releases',
      weeklyDownloads: 37100000,
      author: 'Vercel',
      license: 'MIT',
    })

    const controller = new PackageInfoModalController()
    const state = {
      ...baseState,
      currentVersion: '16.2.1',
      currentVersionSpecifier: '^16.2.1',
      selectedOption: 'latest' as const,
      allVersions: ['16.2.3', '16.2.2', '16.2.1', '16.2.0'],
    }
    await controller.hydrate(state)

    expect(state.description).toBe('Framework')
    expect(state.repository).toBe('https://github.com/vercel/next.js/releases')
    expect(state.vulnerability?.detailsUrl).toBe('https://github.com/advisories/GHSA-1')
  })

  it('returns null when metadata is unavailable', async () => {
    mocks.fetchPackageMetadata.mockResolvedValue(null)

    const controller = new PackageInfoModalController()
    const result = await controller.hydrate({ ...baseState })

    expect(result).toBeNull()
  })

  it('initializes release note cursor state during hydration', async () => {
    mocks.fetchPackageMetadata.mockResolvedValue({
      description: 'Framework',
      releaseNotes: 'https://github.com/vercel/next.js/releases',
    })

    const controller = new PackageInfoModalController()
    const state = {
      ...baseState,
      currentVersion: '16.2.1',
      currentVersionSpecifier: '^16.2.1',
      selectedOption: 'latest' as const,
      allVersions: ['16.2.3', '16.2.2', '16.2.1', '16.2.0'],
    }
    await controller.hydrate(state)

    expect(state.releaseNotesVersions).toEqual(['16.2.3', '16.2.2', '16.2.1'])
    expect(state.releaseNotesLoaded?.size).toBe(0)
    expect(state.releaseNotesViewIndex).toBe(0)
    expect(state.releaseNotesLoadingVersion).toBeUndefined()
    expect(mocks.fetchReleaseNotesForVersion).not.toHaveBeenCalled()
  })

  it('loads the requested release note version by index', async () => {
    const controller = new PackageInfoModalController()
    const state: PackageSelectionState = {
      ...baseState,
      releaseNotesVersions: ['16.2.3', '16.2.2', '16.2.1', '16.2.0'],
      releaseNotesLoaded: new Map([['16.2.3', 'first release']]),
      releaseNotesViewIndex: 0,
    }
    const onLoaded = vi.fn()

    mocks.fetchReleaseNotesForVersion.mockResolvedValueOnce(null)

    const loaded = await controller.loadVersionAtIndex(state, 1, onLoaded)

    expect(loaded).toBe(true)
    expect(mocks.fetchReleaseNotesForVersion.mock.calls).toEqual([['next', '16.2.2', undefined]])
    expect(state.releaseNotesLoaded?.get('16.2.2')).toBeNull()
    expect(state.releaseNotesLoaded?.has('16.2.1')).toBe(false)
    expect(onLoaded).toHaveBeenCalledTimes(2)
  })

  it('navigates between available release note versions', () => {
    const controller = new PackageInfoModalController()
    const state: PackageSelectionState = {
      ...baseState,
      releaseNotesVersions: ['16.2.3', '16.2.2', '16.2.1'],
      releaseNotesLoaded: new Map(),
      releaseNotesViewIndex: 1,
    }

    expect(controller.canNavigate(state, 'newer')).toBe(true)
    expect(controller.canNavigate(state, 'older')).toBe(true)
    expect(controller.navigateVersion(state, 'newer')).toBe(0)
    expect(state.releaseNotesViewIndex).toBe(0)
    expect(controller.navigateVersion(state, 'newer')).toBe(-1)
    expect(controller.navigateVersion(state, 'older')).toBe(1)
    expect(controller.navigateVersion(state, 'older')).toBe(2)
    expect(controller.canNavigate(state, 'older')).toBe(false)
    expect(controller.navigateVersion(state, 'older')).toBe(-1)
  })

  it('passes abort signal to fetchPackageMetadata during hydration', async () => {
    mocks.fetchPackageMetadata.mockResolvedValue({
      description: 'Framework',
      releaseNotes: 'https://github.com/vercel/next.js/releases',
    })

    const controller = new PackageInfoModalController()
    const state = { ...baseState, allVersions: ['16.2.3', '16.2.2', '16.2.1'] }
    await controller.hydrate(state)

    // Verify signal was passed as third argument
    expect(mocks.fetchPackageMetadata).toHaveBeenCalledWith(
      'next',
      '16.2.3',
      expect.objectContaining({ aborted: false })
    )
  })

  it('cancel() aborts in-flight hydration', async () => {
    let resolveMetadata: ((value: any) => void) | undefined
    mocks.fetchPackageMetadata.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMetadata = resolve
        })
    )

    const controller = new PackageInfoModalController()
    const state = { ...baseState }
    const hydratePromise = controller.hydrate(state)

    // Cancel before metadata resolves
    controller.cancel()

    // Verify the signal passed to fetchPackageMetadata is now aborted
    const passedSignal = mocks.fetchPackageMetadata.mock.calls[0][2] as AbortSignal
    expect(passedSignal.aborted).toBe(true)

    // Resolve the metadata to let the promise settle
    resolveMetadata?.(null)
    const result = await hydratePromise
    expect(result).toBeNull()
  })

  it('passes abort signal to fetchReleaseNotesForVersion during loadVersionAtIndex', async () => {
    mocks.fetchPackageMetadata.mockResolvedValue({
      description: 'Framework',
      releaseNotes: 'https://github.com/vercel/next.js/releases',
    })
    mocks.fetchReleaseNotesForVersion.mockResolvedValueOnce('release content')

    const controller = new PackageInfoModalController()
    const state = {
      ...baseState,
      currentVersion: '16.2.1',
      currentVersionSpecifier: '^16.2.1',
      selectedOption: 'latest' as const,
      allVersions: ['16.2.3', '16.2.2', '16.2.1'],
    }
    await controller.hydrate(state)

    const onLoaded = vi.fn()
    await controller.loadVersionAtIndex(state, 0, onLoaded)

    // Verify signal was passed as third argument
    expect(mocks.fetchReleaseNotesForVersion).toHaveBeenCalledWith(
      'next',
      '16.2.3',
      expect.objectContaining({ aborted: false })
    )
  })

  it('clears the loading state when a lazy release notes fetch throws', async () => {
    const controller = new PackageInfoModalController()
    const state: PackageSelectionState = {
      ...baseState,
      releaseNotesVersions: ['16.2.3', '16.2.2'],
      releaseNotesLoaded: new Map([['16.2.3', 'first release']]),
      releaseNotesViewIndex: 0,
    }
    const onLoaded = vi.fn()

    mocks.fetchReleaseNotesForVersion.mockRejectedValueOnce(new Error('network failed'))

    const loaded = await controller.loadVersionAtIndex(state, 1, onLoaded)

    expect(loaded).toBe(true)
    expect(state.releaseNotesLoadingVersion).toBeUndefined()
    expect(state.releaseNotesLoaded?.get('16.2.2')).toBeNull()
    expect(onLoaded).toHaveBeenCalledTimes(2)
  })

  it('does not cache aborted version fetches as missing notes', async () => {
    const controller = new PackageInfoModalController()
    const state: PackageSelectionState = {
      ...baseState,
      releaseNotesVersions: ['16.2.3'],
      releaseNotesLoaded: new Map(),
      releaseNotesViewIndex: 0,
    }
    const onLoaded = vi.fn()

    mocks.fetchReleaseNotesForVersion.mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError')
    )

    const loaded = await controller.loadVersionAtIndex(state, 0, onLoaded)

    expect(loaded).toBe(false)
    expect(state.releaseNotesLoadingVersion).toBeUndefined()
    expect(state.releaseNotesLoaded?.has('16.2.3')).toBe(false)
    expect(onLoaded).toHaveBeenCalledTimes(2)
  })
})
