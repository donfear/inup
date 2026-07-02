export interface PackageMetadata {
  description: string
  homepage?: string
  repository?: {
    url?: string
    type?: string
  }
  bugs?: {
    url?: string
  }
  keywords?: string[]
  author?: string
  license?: string
  latestChangelog?: string
  releaseNotes?: string
  weeklyDownloads?: number
  repositoryUrl?: string
  issuesUrl?: string
  npmUrl?: string
}

export interface GitHubRelease {
  tag_name?: string
  body?: string
  draft?: boolean
}

export interface PackageManifestInput {
  description?: unknown
  homepage?: unknown
  repository?: unknown
  bugs?: unknown
  keywords?: unknown
  author?: unknown
  license?: unknown
}
