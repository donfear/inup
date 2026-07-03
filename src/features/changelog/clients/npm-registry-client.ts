import { NPM_REGISTRY_URL } from '../../../shared/config/constants'
import { registryTargetFor, RegistryTarget } from '../../../shared/registry/registry-config'

const PUBLIC_REGISTRY_ORIGIN = new URL(NPM_REGISTRY_URL).origin

export class NpmRegistryClient {
  constructor(
    private readonly resolveRegistryTarget: (
      packageName: string
    ) => RegistryTarget = registryTargetFor
  ) {}

  async fetchPackageManifest(
    packageName: string,
    version: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown> | null> {
    try {
      const target = this.resolveRegistryTarget(packageName)
      const response = await fetch(
        `${target.origin}${target.pathPrefix}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
            ...(target.authHeader ? { authorization: target.authHeader } : {}),
          },
          signal,
        }
      )

      if (!response.ok) {
        return null
      }

      return (await response.json()) as Record<string, unknown>
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }

      return null
    }
  }

  async fetchDownloadStats(
    packageName: string,
    signal?: AbortSignal
  ): Promise<{ downloads: number } | null> {
    // Download counts only exist for the public registry. Skip the call for
    // packages that resolve elsewhere — no stats there, and private package
    // names should not be sent to api.npmjs.org.
    if (this.resolveRegistryTarget(packageName).origin !== PUBLIC_REGISTRY_ORIGIN) {
      return null
    }
    try {
      const response = await fetch(
        `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}`,
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
          },
          signal,
        }
      )

      if (!response.ok) {
        return null
      }

      const data = (await response.json()) as Record<string, unknown>
      return {
        downloads: (data.downloads as number) || 0,
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }

      return null
    }
  }
}
