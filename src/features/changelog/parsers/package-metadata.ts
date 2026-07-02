import { extractRepositoryUrl } from './repository-ref'
import { PackageManifestInput, PackageMetadata } from '../types'

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
  const repositoryUrl = extractRepositoryUrl(repository?.url || '')
  const npmUrl = `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`
  const issuesUrl = repositoryUrl ? `${repositoryUrl}/issues` : undefined

  const metadata: PackageMetadata = {
    description:
      typeof rawData.description === 'string' && rawData.description
        ? rawData.description
        : 'No description available',
    homepage: typeof rawData.homepage === 'string' ? rawData.homepage : undefined,
    repository,
    bugs,
    keywords,
    author: typeof author === 'string' ? author : undefined,
    license: typeof rawData.license === 'string' ? rawData.license : undefined,
    repositoryUrl,
    npmUrl,
    issuesUrl,
  }

  if (repositoryUrl) {
    metadata.releaseNotes = `${repositoryUrl}/releases`
  }

  return metadata
}
