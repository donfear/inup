import stringWidth from 'string-width'
import stripAnsiPackaged from 'strip-ansi'
import wrapAnsi from 'wrap-ansi'
import cliTruncate from 'cli-truncate'

// Thin wrappers over the battle-tested terminal-string stack (string-width,
// strip-ansi, wrap-ansi, cli-truncate). The previous hand-rolled versions
// handled emoji but had no East Asian Width tables, so CJK text was counted at
// width 1 and misaligned every column that contained it.

export function stripAnsi(text: string): string {
  return stripAnsiPackaged(text)
}

/** Terminal columns `text` occupies: ANSI-aware, emoji- and CJK-correct. */
export function getVisualLength(text: string): number {
  return stringWidth(text)
}

export function truncatePlainText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return ''
  }

  if (getVisualLength(text) <= maxWidth) {
    return text
  }

  if (maxWidth <= 3) {
    return '.'.repeat(maxWidth)
  }

  return cliTruncate(text, maxWidth, { truncationCharacter: '...' })
}

export function wrapPlainText(text: string, maxWidth: number): string[] {
  if (!text) {
    return []
  }

  if (maxWidth <= 0 || getVisualLength(text) <= maxWidth) {
    return [text]
  }

  // Soft wrap: words longer than maxWidth get their own (overflowing) line,
  // matching the previous behavior. ANSI codes are re-balanced per line.
  return wrapAnsi(text, maxWidth).split('\n')
}
