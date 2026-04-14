export function extractReleaseNotesFromHtml(html: string): string | null {
  const bodyContentIndex = html.indexOf('data-test-selector="body-content"')
  if (bodyContentIndex === -1) return null

  const markdownBodyIndex = html.indexOf('class="markdown-body', bodyContentIndex)
  if (markdownBodyIndex === -1) return null

  const contentStart = html.indexOf('>', markdownBodyIndex)
  if (contentStart === -1) return null

  let depth = 1
  let cursor = contentStart + 1

  while (depth > 0 && cursor < html.length) {
    const nextOpen = html.indexOf('<div', cursor)
    const nextClose = html.indexOf('</div>', cursor)

    if (nextClose === -1) return null

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1
      cursor = nextOpen + 4
    } else {
      depth -= 1
      cursor = nextClose + 6
    }
  }

  if (depth !== 0) return null

  const normalized = html
    .slice(contentStart + 1, cursor - 6)
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<h([1-6])[^>]*>/g, (_full, level: string) => `${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]>/g, '\n\n')
    .replace(/<li[^>]*>/g, '- ')
    .replace(/<\/li>/g, '\n')
    .replace(/<p[^>]*>/g, '')
    .replace(/<\/p>/g, '\n\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/g, '$1')
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/g, '**$1**')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/g, '`$1`')
    .replace(/<[^>]+>/g, '')

  const decoded = normalized
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')

  const cleaned = decoded
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return cleaned.length > 0 ? cleaned : null
}
