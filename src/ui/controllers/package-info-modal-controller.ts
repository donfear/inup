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

    return result
  }
}
