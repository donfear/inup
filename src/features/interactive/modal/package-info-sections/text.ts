import { getVisualLength, wrapPlainText } from '../../../../shared/terminal'

export function formatTerminalLink(label: string, url: string): string {
  return `]8;;${url}${label}]8;;`
}

export function getRepositoryBaseUrl(repositoryUrl: string | undefined): string | null {
  if (!repositoryUrl) {
    return null
  }

  return repositoryUrl.replace(/\/releases\/?$/, '')
}

export function sanitizeMarkdownText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function linkifyContributorMentions(text: string): string {
  return text.replace(/(^|[\s(])@([a-zA-Z0-9-]+)/g, (_match, prefix: string, username: string) => {
    return `${prefix}${formatTerminalLink(`@${username}`, `https://github.com/${username}`)}`
  })
}

export function linkifyRepositoryReferences(text: string, repositoryUrl?: string): string {
  const repoBaseUrl = getRepositoryBaseUrl(repositoryUrl)
  if (!repoBaseUrl?.includes('github.com')) {
    return text
  }

  return text
    .replace(/(^|[\s(])#(\d+)\b/g, (_match, prefix: string, number: string) => {
      return `${prefix}${formatTerminalLink(`#${number}`, `${repoBaseUrl}/pull/${number}`)}`
    })
    .replace(/(^|[\s(])([0-9a-f]{7,40})\b/gi, (_match, prefix: string, hash: string) => {
      return `${prefix}${formatTerminalLink(hash, `${repoBaseUrl}/commit/${hash}`)}`
    })
}

export function linkifyMarkdownText(text: string, repositoryUrl?: string): string {
  return linkifyRepositoryReferences(linkifyContributorMentions(text), repositoryUrl)
}

export function pushWrappedLines(
  lines: string[],
  text: string,
  width: number,
  firstPrefix: string,
  restPrefix: string = firstPrefix,
  style?: (value: string) => string
): void {
  const firstWidth = Math.max(1, width - getVisualLength(firstPrefix))
  const restWidth = Math.max(1, width - getVisualLength(restPrefix))
  const segments = wrapPlainText(text, firstWidth)

  if (segments.length === 0) {
    lines.push(firstPrefix.trimEnd())
    return
  }

  lines.push(firstPrefix + (style ? style(segments[0]) : segments[0]))
  for (let i = 1; i < segments.length; i++) {
    const wrappedSegments = wrapPlainText(segments[i], restWidth)
    for (const segment of wrappedSegments) {
      lines.push(restPrefix + (style ? style(segment) : segment))
    }
  }
}

export function isLowSignalTrailerLine(text: string): boolean {
  const normalized = text.toLowerCase()
  return (
    normalized.startsWith('compare') ||
    normalized.startsWith('full changelog') ||
    normalized.startsWith('see full changelog') ||
    normalized.startsWith('release notes') ||
    normalized.includes('/compare/') ||
    /^\w+: https?:\/\//.test(normalized)
  )
}
