import * as semver from 'semver'
import { changelogFetcher } from '../../services'
import { PackageSelectionState } from '../../types'

export interface PackageInfoModalHydrationResult {
  description?: string
  homepage?: string
  repository?: string
  weeklyDownloads?: number
  author?: string
  license?: string
}

export class PackageInfoModalController {
  private abortController: AbortController | null = null
  private pendingReleaseNotesVersion: string | null = null

  /**
   * Cancel any in-flight hydrate/release-notes fetches.
   * Safe to call multiple times or when nothing is in flight.
   */
  cancel(): void {
    this.abortController?.abort()
    this.abortController = null
    this.pendingReleaseNotesVersion = null
  }

  async hydrate(state: PackageSelectionState): Promise<PackageInfoModalHydrationResult | null> {
    // Abort any previous session
    this.cancel()
    const controller = new AbortController()
    this.abortController = controller

    const metadata = await changelogFetcher.fetchPackageMetadata(
      state.name,
      state.latestVersion,
      controller.signal
    )
    if (!metadata) {
      return null
    }

    const result: PackageInfoModalHydrationResult = {
      description: metadata.description,
      homepage: metadata.homepage,
      repository: metadata.releaseNotes,
      weeklyDownloads: metadata.weeklyDownloads,
      author: metadata.author as string | undefined,
      license: metadata.license,
    }

    state.description = result.description
    state.homepage = result.homepage
    state.repository = result.repository
    state.weeklyDownloads = result.weeklyDownloads
    state.author = result.author
    state.license = result.license

    // Compute the version range for release notes
    const targetVersion =
      state.selectedOption === 'range' ? state.rangeVersion : state.latestVersion
    if (state.allVersions && state.allVersions.length > 0) {
      state.releaseNotesVersions = this.buildReleaseNotesVersionQueue(
        state.allVersions,
        state.currentVersion,
        targetVersion
      )
    } else {
      // No allVersions available — just show the target version
      state.releaseNotesVersions = [targetVersion]
    }

    state.releaseNotesLoaded = new Map()
    state.releaseNotesViewIndex = 0
    state.releaseNotesLoadingVersion = undefined
    this.pendingReleaseNotesVersion = null

    return result
  }

  /**
   * Load release notes for a specific version by index.
   * Returns true if a load was triggered, false if nothing to load.
   */
  async loadVersionAtIndex(
    state: PackageSelectionState,
    index: number,
    onLoaded: () => void
  ): Promise<boolean> {
    if (!state.releaseNotesVersions || !state.releaseNotesLoaded) return false
    if (index < 0 || index >= state.releaseNotesVersions.length) return false

    const version = state.releaseNotesVersions[index]

    // Already loaded
    if (state.releaseNotesLoaded.has(version)) return false

    if (state.releaseNotesLoadingVersion) {
      this.pendingReleaseNotesVersion = version
      return false
    }

    return await this.loadVersion(state, version, onLoaded)
  }

  private async loadVersion(
    state: PackageSelectionState,
    version: string,
    onLoaded: () => void
  ): Promise<boolean> {
    const loadedNotes = state.releaseNotesLoaded
    if (!loadedNotes) return false

    state.releaseNotesLoadingVersion = version
    onLoaded() // Re-render to show loading indicator

    try {
      const notes = await changelogFetcher.fetchReleaseNotesForVersion(
        state.name,
        version,
        this.abortController?.signal
      )
      loadedNotes.set(version, notes)
      return true
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return false
      }
      loadedNotes.set(version, null)
      return true
    } finally {
      state.releaseNotesLoadingVersion = undefined
      onLoaded() // Re-render with new content or recovered state

      const pendingVersion = this.pendingReleaseNotesVersion
      this.pendingReleaseNotesVersion = null

      if (
        pendingVersion &&
        pendingVersion !== version &&
        loadedNotes &&
        !loadedNotes.has(pendingVersion)
      ) {
        void this.loadVersion(state, pendingVersion, onLoaded)
      }
    }
  }

  /**
   * Navigate to the next or previous version in the release notes list.
   * Returns the new view index, or -1 if navigation is not possible.
   */
  navigateVersion(state: PackageSelectionState, direction: 'newer' | 'older'): number {
    if (!state.releaseNotesVersions || state.releaseNotesVersions.length === 0) return -1

    const currentIndex = state.releaseNotesViewIndex ?? 0
    const newIndex = direction === 'older' ? currentIndex + 1 : currentIndex - 1

    if (newIndex < 0 || newIndex >= state.releaseNotesVersions.length) return -1

    state.releaseNotesViewIndex = newIndex
    return newIndex
  }

  /**
   * Check if the version at the given index is already loaded.
   */
  isVersionLoaded(state: PackageSelectionState, index: number): boolean {
    if (!state.releaseNotesVersions || !state.releaseNotesLoaded) return false
    if (index < 0 || index >= state.releaseNotesVersions.length) return false
    return state.releaseNotesLoaded.has(state.releaseNotesVersions[index])
  }

  /**
   * Get the total number of versions available.
   */
  getVersionCount(state: PackageSelectionState): number {
    return state.releaseNotesVersions?.length ?? 0
  }

  /**
   * Check if navigation in a direction is possible.
   */
  canNavigate(state: PackageSelectionState, direction: 'newer' | 'older'): boolean {
    if (!state.releaseNotesVersions || state.releaseNotesVersions.length === 0) return false
    const currentIndex = state.releaseNotesViewIndex ?? 0
    if (direction === 'newer') return currentIndex > 0
    return currentIndex < state.releaseNotesVersions.length - 1
  }

  private buildReleaseNotesVersionQueue(
    allVersions: string[],
    currentVersion: string,
    targetVersion: string
  ): string[] {
    const cleanTarget = semver.clean(targetVersion)
    if (!cleanTarget) {
      return []
    }

    const cleanCurrent = semver.clean(currentVersion)
    const versionsAtOrBelowTarget = Array.from(
      new Set(
        allVersions
          .map((version) => semver.clean(version))
          .filter((version): version is string => version !== null)
          .filter((version) => semver.lte(version, cleanTarget))
      )
    ).sort(semver.rcompare)

    if (!cleanCurrent) {
      return versionsAtOrBelowTarget
    }

    const relevantVersions = versionsAtOrBelowTarget.filter((version) =>
      semver.gte(version, cleanCurrent)
    )

    return relevantVersions
  }
}
