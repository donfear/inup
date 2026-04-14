import * as semver from 'semver'
import { PackageManifestInput, PackageMetadata } from '../types/changelog.types'
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

  getRepositoryReleaseUrl(packageName: string, version: string): string | null {
    return this.metadataService.getRepositoryReleaseUrl(packageName, version)
  }

  cacheMetadata(packageName: string, rawData: PackageManifestInput): void {
    this.metadataService.cacheMetadata(packageName, rawData)
  }

  getVersionsBetween(allVersions: string[], fromVersion: string, toVersion: string): string[] {
    const cleanFrom = semver.clean(fromVersion)
    const cleanTo = semver.clean(toVersion)
    if (!cleanFrom || !cleanTo) return []

    return allVersions
      .filter((version) => {
        const cleaned = semver.clean(version)
        if (!cleaned) return false
        return semver.gt(cleaned, cleanFrom) && semver.lte(cleaned, cleanTo)
      })
      .sort(semver.rcompare)
  }

  async fetchReleaseNotesForVersion(
    packageName: string,
    version: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    return await this.releaseNotesService.fetchReleaseNotesForVersion(packageName, version, signal)
  }

  clearCache(): void {
    this.metadataService.clearCache()
    this.releaseNotesService.clearCache()
  }
}

export const changelogFetcher = new ChangelogFetcher()
