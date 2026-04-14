import { JSDELIVR_CDN_URL } from '../../../config/constants'
import { fetchExactPackageManifest } from '../../../services/jsdelivr-registry'

export class JsdelivrClient {
  async fetchExactPackageManifest(
    packageName: string,
    version: string
  ): Promise<Record<string, unknown> | null> {
    return await fetchExactPackageManifest(packageName, version)
  }

  async fetchChangelog(
    packageName: string,
    version: string,
    signal: AbortSignal
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `${JSDELIVR_CDN_URL}/${encodeURIComponent(packageName)}@${version}/CHANGELOG.md`,
        {
          method: 'GET',
          signal,
        }
      )

      if (!response.ok) return null

      return await response.text()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }

      return null
    }
  }
}
