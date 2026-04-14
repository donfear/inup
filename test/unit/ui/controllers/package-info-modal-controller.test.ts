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
    mocks.fetchReleaseNotesForVersion.mockResolvedValueOnce('first release')

    const controller = new PackageInfoModalController()
    const state = {
      ...baseState,
      selectedOption: 'latest' as const,
      allVersions: ['16.2.3', '16.2.2', '16.2.1', '16.2.0'],
    }
    await controller.hydrate(state)

    expect(state.releaseNotesVersions).toEqual(['16.2.3', '16.2.2', '16.2.1', '16.2.0'])
    expect(state.releaseNotesLoaded?.get('16.2.3')).toBe('first release')
    expect(state.releaseNotesNextIndex).toBe(1)
    expect(state.releaseNotesLoadMoreArmed).toBe(true)
  })

  it('loads release notes sequentially with a cursor and skips empty versions in one batch', async () => {
    const controller = new PackageInfoModalController()
    const state: PackageSelectionState = {
      ...baseState,
      releaseNotesVersions: ['16.2.3', '16.2.2', '16.2.1', '16.2.0'],
      releaseNotesLoaded: new Map([['16.2.3', 'first release']]),
      releaseNotesNextIndex: 1,
    }
    const onLoaded = vi.fn()

    mocks.fetchReleaseNotesForVersion
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('second release')

    const loaded = await controller.loadNextVersion(state, onLoaded)

    expect(loaded).toBe(true)
    expect(mocks.fetchReleaseNotesForVersion.mock.calls).toEqual([
      ['next', '16.2.2'],
      ['next', '16.2.1'],
    ])
    expect(state.releaseNotesLoaded?.get('16.2.2')).toBeNull()
    expect(state.releaseNotesLoaded?.get('16.2.1')).toBe('second release')
    expect(state.releaseNotesNextIndex).toBe(3)
    expect(controller.hasMoreVersions(state)).toBe(true)
    expect(onLoaded).toHaveBeenCalledTimes(2)
  })
})
