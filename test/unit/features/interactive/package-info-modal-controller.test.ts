import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchPackageMetadata: vi.fn(),
  getVersionsBetween: vi.fn().mockReturnValue([]),
  fetchReleaseNotesForVersion: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../../../src/features/changelog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/features/changelog')>()),
  changelogFetcher: {
    fetchPackageMetadata: mocks.fetchPackageMetadata,
    getVersionsBetween: mocks.getVersionsBetween,
    fetchReleaseNotesForVersion: mocks.fetchReleaseNotesForVersion,
  },
}))

import { PackageInfoModalController } from '../../../../src/features/interactive/controllers'
import type { PackageSelectionState } from '../../../../src/shared/types'
import { makeSelectionState } from '../../../fixtures/selection-state-factory'

const baseState = makeSelectionState({
  name: 'next',
  currentVersionSpecifier: '^16.1.6',
  currentVersion: '16.1.6',
  rangeVersion: '16.2.0',
  latestVersion: '16.2.3',
  selectedOption: 'range',
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
})

describe('PackageInfoModalController', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mocks.fetchPackageMetadata.mockReset()
    mocks.getVersionsBetween.mockReset()
    mocks.fetchReleaseNotesForVersion.mockReset()
    mocks.getVersionsBetween.mockReturnValue([])
    mocks.fetchReleaseNotesForVersion.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns a StateUpdate with hydrated fields and does not mutate vulnerability', async () => {
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
    const update = await controller.hydrate(state)

    expect(update).not.toBeNull()
    expect(update!.name).toBe('next')
    expect(update!.patch.description).toBe('Framework')
    expect(update!.patch.repository).toBe('https://github.com/vercel/next.js/releases')
    // state itself is not mutated
    expect(state.description).toBeUndefined()
    // vulnerability is not touched by hydrate
    expect(state.vulnerability?.detailsUrl).toBe('https://github.com/advisories/GHSA-1')
  })

  it('returns null when metadata is unavailable', async () => {
    mocks.fetchPackageMetadata.mockResolvedValue(null)

    const controller = new PackageInfoModalController()
    const result = await controller.hydrate({ ...baseState })

    expect(result).toBeNull()
  })

  it('initializes release note cursor state in the returned patch', async () => {
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
    const update = await controller.hydrate(state)

    expect(update).not.toBeNull()
    expect(update!.patch.releaseNotesVersions).toEqual(['16.2.3', '16.2.2', '16.2.1'])
    expect(update!.patch.releaseNotesLoaded?.size).toBe(0)
    expect(update!.patch.releaseNotesViewIndex).toBe(0)
    expect(update!.patch.releaseNotesLoadingVersion).toBeUndefined()
    expect(mocks.fetchReleaseNotesForVersion).not.toHaveBeenCalled()
  })

  it('loads the requested release note version by index', async () => {
    vi.useFakeTimers()

    const controller = new PackageInfoModalController()
    const state: PackageSelectionState = {
      ...baseState,
      releaseNotesVersions: ['16.2.3', '16.2.2', '16.2.1', '16.2.0'],
      releaseNotesLoaded: new Map([['16.2.3', 'first release']]),
      releaseNotesViewIndex: 0,
    }
    const onLoaded = vi.fn()

    mocks.fetchReleaseNotesForVersion.mockResolvedValueOnce(null)

    const pendingLoad = controller.loadVersionAtIndex(state, 1, onLoaded)
    await vi.runAllTimersAsync()
    const loaded = await pendingLoad

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
    vi.useFakeTimers()

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
    const update = await controller.hydrate(state)
    if (update) Object.assign(state, update.patch)

    const onLoaded = vi.fn()
    const pendingLoad = controller.loadVersionAtIndex(state, 0, onLoaded)
    await vi.runAllTimersAsync()
    await pendingLoad

    // Verify signal was passed as third argument
    expect(mocks.fetchReleaseNotesForVersion).toHaveBeenCalledWith(
      'next',
      '16.2.3',
      expect.objectContaining({ aborted: false })
    )
  })

  it('clears the loading state when a lazy release notes fetch throws', async () => {
    vi.useFakeTimers()

    const controller = new PackageInfoModalController()
    const state: PackageSelectionState = {
      ...baseState,
      releaseNotesVersions: ['16.2.3', '16.2.2'],
      releaseNotesLoaded: new Map([['16.2.3', 'first release']]),
      releaseNotesViewIndex: 0,
    }
    const onLoaded = vi.fn()

    mocks.fetchReleaseNotesForVersion.mockRejectedValueOnce(new Error('network failed'))

    const pendingLoad = controller.loadVersionAtIndex(state, 1, onLoaded)
    await vi.runAllTimersAsync()
    const loaded = await pendingLoad

    expect(loaded).toBe(true)
    expect(state.releaseNotesLoadingVersion).toBeUndefined()
    expect(state.releaseNotesLoaded?.get('16.2.2')).toBeNull()
    expect(onLoaded).toHaveBeenCalledTimes(2)
  })

  it('does not cache aborted version fetches as missing notes', async () => {
    vi.useFakeTimers()

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

    const pendingLoad = controller.loadVersionAtIndex(state, 0, onLoaded)
    await vi.runAllTimersAsync()
    const loaded = await pendingLoad

    expect(loaded).toBe(false)
    expect(state.releaseNotesLoadingVersion).toBeUndefined()
    expect(state.releaseNotesLoaded?.has('16.2.3')).toBe(false)
    expect(onLoaded).toHaveBeenCalledTimes(2)
  })

  it('queues the latest requested version while another release notes fetch is in flight', async () => {
    vi.useFakeTimers()

    let resolveFirstLoad: ((value: string | null) => void) | undefined

    mocks.fetchReleaseNotesForVersion
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstLoad = resolve
          })
      )
      .mockResolvedValueOnce('queued release notes')

    const controller = new PackageInfoModalController()
    const state: PackageSelectionState = {
      ...baseState,
      releaseNotesVersions: ['16.2.3', '16.2.2', '16.2.1'],
      releaseNotesLoaded: new Map(),
      releaseNotesViewIndex: 0,
    }
    const onLoaded = vi.fn()

    const firstLoad = controller.loadVersionAtIndex(state, 0, onLoaded)
    await vi.runAllTimersAsync()
    const queued = await controller.loadVersionAtIndex(state, 2, onLoaded)

    expect(queued).toBe(false)
    expect(mocks.fetchReleaseNotesForVersion).toHaveBeenCalledTimes(1)
    expect(state.releaseNotesLoadingVersion).toBe('16.2.3')

    resolveFirstLoad?.('first release notes')
    await firstLoad
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.fetchReleaseNotesForVersion.mock.calls).toEqual([
      ['next', '16.2.3', undefined],
      ['next', '16.2.1', undefined],
    ])
    expect(state.releaseNotesLoaded?.get('16.2.3')).toBe('first release notes')
    expect(state.releaseNotesLoaded?.get('16.2.1')).toBe('queued release notes')
  })

  it('debounces rapid release note navigation and only fetches the last requested version', async () => {
    vi.useFakeTimers()

    mocks.fetchReleaseNotesForVersion.mockResolvedValue('latest requested notes')

    const controller = new PackageInfoModalController()
    const state: PackageSelectionState = {
      ...baseState,
      releaseNotesVersions: ['16.2.3', '16.2.2', '16.2.1'],
      releaseNotesLoaded: new Map(),
      releaseNotesViewIndex: 0,
    }
    const onLoaded = vi.fn()

    void controller.loadVersionAtIndex(state, 0, onLoaded)
    void controller.loadVersionAtIndex(state, 1, onLoaded)
    const lastLoad = controller.loadVersionAtIndex(state, 2, onLoaded)

    expect(mocks.fetchReleaseNotesForVersion).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()
    const loaded = await lastLoad

    expect(loaded).toBe(true)
    expect(mocks.fetchReleaseNotesForVersion.mock.calls).toEqual([['next', '16.2.1', undefined]])
    expect(state.releaseNotesLoaded?.has('16.2.3')).toBe(false)
    expect(state.releaseNotesLoaded?.has('16.2.2')).toBe(false)
    expect(state.releaseNotesLoaded?.get('16.2.1')).toBe('latest requested notes')
  })
  it('covers the guard rails for states without release note data', async () => {
    const controller = new PackageInfoModalController()
    const bare = makeSelectionState({
      releaseNotesVersions: undefined,
      releaseNotesLoaded: undefined,
    })

    expect(await controller.loadVersionAtIndex(bare, 0, () => {})).toBe(false)
    expect(controller.navigateVersion(bare, 'older')).toBe(-1)
    expect(controller.isVersionLoaded(bare, 0)).toBe(false)
    expect(controller.getVersionCount(bare)).toBe(0)
    expect(controller.canNavigate(bare, 'older')).toBe(false)
    expect(controller.canNavigate(bare, 'newer')).toBe(false)
  })

  it('rejects out-of-range indices and already-loaded versions', async () => {
    const controller = new PackageInfoModalController()
    const state = makeSelectionState({
      releaseNotesVersions: ['2.0.0'],
      releaseNotesLoaded: new Map([['2.0.0', 'cached notes']]),
    })

    expect(await controller.loadVersionAtIndex(state, -1, () => {})).toBe(false)
    expect(await controller.loadVersionAtIndex(state, 5, () => {})).toBe(false)
    expect(await controller.loadVersionAtIndex(state, 0, () => {})).toBe(false) // already loaded
    expect(controller.isVersionLoaded(state, -1)).toBe(false)
    expect(controller.isVersionLoaded(state, 5)).toBe(false)
    expect(controller.isVersionLoaded(state, 0)).toBe(true)
    expect(mocks.fetchReleaseNotesForVersion).not.toHaveBeenCalled()
  })

  it('reports navigation availability at the list boundaries', () => {
    const controller = new PackageInfoModalController()
    const state = makeSelectionState({
      releaseNotesVersions: ['2.0.0', '1.5.0'],
      releaseNotesViewIndex: 0,
    })

    expect(controller.canNavigate(state, 'newer')).toBe(false)
    expect(controller.canNavigate(state, 'older')).toBe(true)
    expect(controller.navigateVersion(state, 'newer')).toBe(-1)

    state.releaseNotesViewIndex = 1
    expect(controller.canNavigate(state, 'newer')).toBe(true)
    expect(controller.canNavigate(state, 'older')).toBe(false)
    expect(controller.navigateVersion(state, 'older')).toBe(-1)
  })

  it('cancel() flushes a pending debounced load as not-loaded', async () => {
    vi.useFakeTimers()
    const controller = new PackageInfoModalController()
    const state = makeSelectionState({
      releaseNotesVersions: ['2.0.0'],
      releaseNotesLoaded: new Map(),
    })

    const pending = controller.loadVersionAtIndex(state, 0, () => {})
    controller.cancel() // clears the debounce timer before it fires

    await expect(pending).resolves.toBe(false)
    expect(mocks.fetchReleaseNotesForVersion).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('hydrate() clears a still-armed debounce timer', async () => {
    vi.useFakeTimers()
    mocks.fetchPackageMetadata.mockResolvedValue({
      description: 'demo',
      homepage: 'https://demo.dev',
    })
    const controller = new PackageInfoModalController()
    const state = makeSelectionState({
      releaseNotesVersions: ['2.0.0'],
      releaseNotesLoaded: new Map(),
    })

    const pending = controller.loadVersionAtIndex(state, 0, () => {})
    // hydrate() completes before the debounce fires: the timer is still armed
    // and must be cleared, flushing the pending load as not-loaded.
    const update = await controller.hydrate(baseState)

    expect(update).not.toBeNull()
    await expect(pending).resolves.toBe(false)
    expect(mocks.fetchReleaseNotesForVersion).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('clears a debounce armed while hydration was in flight', async () => {
    vi.useFakeTimers()
    let resolveFetch: ((value: unknown) => void) | undefined
    mocks.fetchPackageMetadata.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        })
    )
    const controller = new PackageInfoModalController()

    const hydrating = controller.hydrate(baseState)
    // Arm a debounce while the metadata fetch is still in flight; hydrate must
    // clear it when it completes.
    const state = makeSelectionState({
      releaseNotesVersions: ['2.0.0'],
      releaseNotesLoaded: new Map(),
    })
    const pending = controller.loadVersionAtIndex(state, 0, () => {})
    resolveFetch!({ description: 'demo', homepage: 'https://demo.dev' })

    const update = await hydrating
    expect(update).not.toBeNull()
    await expect(pending).resolves.toBe(false)
    expect(mocks.fetchReleaseNotesForVersion).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('resolves false when the notes map vanishes before the debounce fires', async () => {
    vi.useFakeTimers()
    const controller = new PackageInfoModalController()
    const state = makeSelectionState({
      releaseNotesVersions: ['2.0.0'],
      releaseNotesLoaded: new Map(),
    })

    const pending = controller.loadVersionAtIndex(state, 0, () => {})
    state.releaseNotesLoaded = undefined
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toBe(false)
    expect(mocks.fetchReleaseNotesForVersion).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('treats a missing view index as the newest version', () => {
    const controller = new PackageInfoModalController()
    const state = makeSelectionState({ releaseNotesVersions: ['2.0.0', '1.0.0'] })

    expect(controller.canNavigate(state, 'older')).toBe(true)
    expect(controller.navigateVersion(state, 'older')).toBe(1)
  })

  it('hydrate() cancels a pending debounced load from a previous package', async () => {
    vi.useFakeTimers()
    mocks.fetchPackageMetadata.mockResolvedValue({
      description: 'demo',
      homepage: 'https://demo.dev',
    })
    const controller = new PackageInfoModalController()
    const state = makeSelectionState({
      releaseNotesVersions: ['2.0.0'],
      releaseNotesLoaded: new Map(),
    })

    const pending = controller.loadVersionAtIndex(state, 0, () => {})
    const hydrating = controller.hydrate(baseState)
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toBe(false)
    await hydrating
    expect(mocks.fetchReleaseNotesForVersion).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('resolves false when the debounce fires while another version is loading', async () => {
    vi.useFakeTimers()
    const controller = new PackageInfoModalController()
    const state = makeSelectionState({
      releaseNotesVersions: ['2.0.0', '1.5.0'],
      releaseNotesLoaded: new Map(),
      releaseNotesLoadingVersion: undefined,
    })

    const first = controller.loadVersionAtIndex(state, 0, () => {})
    state.releaseNotesLoadingVersion = '9.9.9' // something else started loading meanwhile
    await vi.runAllTimersAsync()

    await expect(first).resolves.toBe(false)
    expect(mocks.fetchReleaseNotesForVersion).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('builds an empty version queue for non-semver targets', async () => {
    mocks.fetchPackageMetadata.mockResolvedValue({ description: 'demo' })
    const controller = new PackageInfoModalController()
    const state = makeSelectionState({
      allVersions: ['1.0.0', '2.0.0'],
      selectedOption: 'latest',
      latestVersion: 'not-a-version',
    })

    const update = await controller.hydrate(state)

    expect(update?.patch.releaseNotesVersions).toEqual([])
  })

  it('keeps every version at or below target when the current version is not semver', async () => {
    mocks.fetchPackageMetadata.mockResolvedValue({ description: 'demo' })
    const controller = new PackageInfoModalController()
    const state = makeSelectionState({
      allVersions: ['0.5.0', '1.0.0', '2.0.0', '3.0.0'],
      currentVersion: 'workspace:*',
      selectedOption: 'latest',
      latestVersion: '2.0.0',
    })

    const update = await controller.hydrate(state)

    expect(update?.patch.releaseNotesVersions).toEqual(['2.0.0', '1.0.0', '0.5.0'])
  })
})
