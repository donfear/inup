import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchPackageMetadata: vi.fn(),
}))

vi.mock('../../../../src/services', () => ({
  changelogFetcher: {
    fetchPackageMetadata: mocks.fetchPackageMetadata,
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
    const state = { ...baseState }
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
})
