import { NPM_REGISTRY_URL } from '../../../config/constants'

export class NpmRegistryClient {
  async fetchPackageManifest(
    packageName: string,
    version: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(
        `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
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
