import { stripControlCharacters } from '../../../shared/terminal'
import type { PackageManifestInput, PackageMetadata } from '../types'
import { extractRepositoryUrl } from './repository-ref'

// Registry fields are free text from the package author, printed to the terminal.
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? stripControlCharacters(value) : undefined

export function mapPackageManifestToMetadata(
  packageName: string,
  rawData: PackageManifestInput
): PackageMetadata {
  const repository = rawData.repository as { url?: string; type?: string } | undefined
  const bugs = rawData.bugs as { url?: string } | undefined
  const keywords = Array.isArray(rawData.keywords) ? (rawData.keywords as string[]) : []
  const author =
    typeof rawData.author === 'object' && rawData.author !== null
      ? ((rawData.author as { name?: string }).name ?? rawData.author)
      : rawData.author
  const repositoryUrl = extractRepositoryUrl(text(repository?.url) ?? '')
  const npmUrl = `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`
  const issuesUrl = repositoryUrl ? `${repositoryUrl}/issues` : undefined

  const metadata: PackageMetadata = {
    description: text(rawData.description) || 'No description available',
    homepage: text(rawData.homepage),
    repository,
    bugs,
    keywords,
    author: text(author),
    license: text(rawData.license),
    repositoryUrl,
    npmUrl,
    issuesUrl,
  }

  if (repositoryUrl) {
    metadata.releaseNotes = `${repositoryUrl}/releases`
  }

  return metadata
}
