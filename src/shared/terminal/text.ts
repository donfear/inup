import { stripVTControlCharacters } from 'node:util'
import cliTruncate from 'cli-truncate'
import stringWidth from 'string-width'
import wrapAnsi from 'wrap-ansi'

// Thin wrappers over the battle-tested terminal-string stack (string-width,
// wrap-ansi, cli-truncate). The previous hand-rolled versions handled emoji but
// had no East Asian Width tables, so CJK text was counted at width 1 and
// misaligned every column that contained it. Stripping is the one piece Node
// ships itself, so it needs no dependency.

export function stripAnsi(text: string): string {
  return stripVTControlCharacters(text)
}

// C0 controls except \t and \n, DEL, and the C1 range (\x9b is an 8-bit CSI).
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

/**
 * Make untrusted text (registry fields, release notes) safe to print: a package
 * author could otherwise embed escape sequences that write the clipboard (OSC 52),
 * retitle the terminal or move the cursor. Whole sequences go first so their
 * parameters don't linger as junk; any stray control character left over is
 * dropped. Line breaks and tabs are kept.
 */
export function stripControlCharacters(text: string): string {
  return stripVTControlCharacters(text).replace(CONTROL_CHARACTERS, '')
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
