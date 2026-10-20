import { stripVTControlCharacters } from 'node:util'
import type cliTruncate from 'cli-truncate'
import type stringWidth from 'string-width'
import type wrapAnsi from 'wrap-ansi'

// Thin wrappers over the battle-tested terminal-string stack (string-width,
// wrap-ansi, cli-truncate). The previous hand-rolled versions handled emoji but
// had no East Asian Width tables, so CJK text was counted at width 1 and
// misaligned every column that contained it. Stripping is the one piece Node
// ships itself, so it needs no dependency.
//
// The stack costs ~25 ms to load (string-width builds an Intl.Segmenter and its
// Unicode tables up front), and --version, --json and the registry path only
// strip text, never measure it. So each library is required on first use rather
// than imported at the top: tsc emits CommonJS, and require() of these ESM-only
// packages returns their namespace.

/** `load()` on the first call, the same value after. */
function once<T>(load: () => T): () => T {
  let value: T | undefined
  return () => {
    value ??= load()
    return value
  }
}

const loadStringWidth = once(
  () => (require('string-width') as { default: typeof stringWidth }).default
)
const loadCliTruncate = once(
  () => (require('cli-truncate') as { default: typeof cliTruncate }).default
)
const loadWrapAnsi = once(() => (require('wrap-ansi') as { default: typeof wrapAnsi }).default)

// One column per character, so the width is the length: printable ASCII (string-width's
// own fast path) plus the ellipsis our progress lines end in, which string-width also
// counts as one (East Asian Ambiguous, narrow). Neither combines with a neighbor into a
// wider cluster. Taken here so a headless run's progress line never loads the stack.
const SINGLE_COLUMN_TEXT = /^[ -~…]*$/

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
  if (SINGLE_COLUMN_TEXT.test(text)) {
    return text.length
  }
  return loadStringWidth()(text)
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

  return loadCliTruncate()(text, maxWidth, { truncationCharacter: '...' })
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
  return loadWrapAnsi()(text, maxWidth).split('\n')
}
