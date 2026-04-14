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
  async hydrate(state: PackageSelectionState): Promise<PackageInfoModalHydrationResult | null> {
    const metadata = await changelogFetcher.fetchPackageMetadata(state.name, state.latestVersion)
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
      state.releaseNotesVersions = changelogFetcher.getVersionsBetween(
        state.allVersions,
        state.currentVersion,
        targetVersion
      )
    } else {
      // No allVersions available — just show the target version
      state.releaseNotesVersions = [targetVersion]
    }

    state.releaseNotesLoaded = new Map()

    // Fetch release notes for the first (target) version
    if (state.releaseNotesVersions.length > 0) {
      const firstVersion = state.releaseNotesVersions[0]
      state.releaseNotesLoadingVersion = firstVersion
      const notes = await changelogFetcher.fetchReleaseNotesForVersion(state.name, firstVersion)
      state.releaseNotesLoaded.set(firstVersion, notes)
      state.releaseNotesLoadingVersion = undefined
    }

    return result
  }

  /**
   * Load the next unloaded version(s) release notes.
   * If a version has no notes, keeps loading the next one (up to a batch limit)
   * so the user doesn't scroll through empty entries.
   * Returns true if a load was triggered, false if nothing to load.
   */
  async loadNextVersion(
    state: PackageSelectionState,
    onLoaded: () => void
  ): Promise<boolean> {
    if (!state.releaseNotesVersions || !state.releaseNotesLoaded) return false
    if (state.releaseNotesLoadingVersion) return false // Already loading

    const maxBatch = 5 // Try up to 5 versions to find one with content
    let loaded = false

    for (let i = 0; i < maxBatch; i++) {
      const nextVersion = state.releaseNotesVersions.find(
        (v) => !state.releaseNotesLoaded!.has(v)
      )
      if (!nextVersion) break // All versions loaded

      state.releaseNotesLoadingVersion = nextVersion
      if (!loaded) onLoaded() // Re-render to show loading indicator on first attempt

      const notes = await changelogFetcher.fetchReleaseNotesForVersion(state.name, nextVersion)
      state.releaseNotesLoaded!.set(nextVersion, notes)
      state.releaseNotesLoadingVersion = undefined
      loaded = true

      if (notes) break // Found content, stop loading more
    }

    if (loaded) onLoaded() // Re-render with new content
    return loaded
  }

  /**
   * Check if there are more versions to load.
   */
  hasMoreVersions(state: PackageSelectionState): boolean {
    if (!state.releaseNotesVersions || !state.releaseNotesLoaded) return false
    return state.releaseNotesVersions.some((v) => !state.releaseNotesLoaded!.has(v))
  }
}
