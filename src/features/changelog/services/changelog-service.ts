import type { PackageMetadata } from '../types'
import { PackageMetadataService } from './package-metadata-service'
import { ReleaseNotesService } from './release-notes-service'

export class ChangelogFetcher {
  private readonly metadataService = new PackageMetadataService()
  private readonly releaseNotesService = new ReleaseNotesService(this.metadataService)

  async fetchPackageMetadata(
    packageName: string,
    version?: string,
    signal?: AbortSignal
  ): Promise<PackageMetadata | null> {
    return await this.metadataService.fetchPackageMetadata(packageName, version, signal)
  }

  async fetchReleaseNotesForVersion(
    packageName: string,
    version: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    return await this.releaseNotesService.fetchReleaseNotesForVersion(packageName, version, signal)
  }
}

export const changelogFetcher = new ChangelogFetcher()
