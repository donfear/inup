export function extractRepositoryUrl(repoUrl: string): string {
  if (!repoUrl) return ''

  let cleanUrl = repoUrl
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^github:/, 'https://github.com/')

  if (!cleanUrl.startsWith('http')) {
    cleanUrl = `https://github.com/${cleanUrl}`
  }

  return cleanUrl
}

export function parseGitHubRepo(repoUrl: string): { owner: string; repo: string } | null {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (!match) return null

  return {
    owner: match[1],
    repo: match[2],
  }
}
