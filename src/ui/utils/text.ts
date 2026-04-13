import { VersionUtils } from './version'

export function stripAnsi(text: string): string {
  return VersionUtils.stripAnsi(text)
}

export function getVisualLength(text: string): number {
  const cleaned = stripAnsi(text)
  let length = 0

  for (const char of cleaned) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint >= 0x1f000 || codePoint >= 0x2600) {
      length += 2
    } else {
      length += 1
    }
  }

  return length
}

export function truncatePlainText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return ''
  }

  if (text.length <= maxWidth) {
    return text
  }

  if (maxWidth <= 3) {
    return '.'.repeat(maxWidth)
  }

  return text.substring(0, maxWidth - 3) + '...'
}

export function wrapPlainText(text: string, maxWidth: number): string[] {
  if (!text) {
    return []
  }

  if (maxWidth <= 0 || text.length <= maxWidth) {
    return [text]
  }

  const lines: string[] = []
  let current = ''
  const words = text.split(' ')

  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxWidth) {
      if (current) {
        lines.push(current)
      }
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }

  if (current) {
    lines.push(current)
  }

  return lines
}
