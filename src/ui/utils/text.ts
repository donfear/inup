import { VersionUtils } from './version'

export function stripAnsi(text: string): string {
  return VersionUtils.stripAnsi(text)
}

export function getVisualLength(text: string): number {
  const cleaned = stripAnsi(text)
  const SegmenterCtor = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity: 'grapheme' }
      ) => {
        segment(input: string): Iterable<{ segment: string }>
      }
    }
  ).Segmenter
  let length = 0

  const segments = SegmenterCtor
    ? SegmenterCtor.prototype.segment.call(
        new SegmenterCtor(undefined, { granularity: 'grapheme' }),
        cleaned
      )
    : cleaned

  for (const item of segments) {
    const segment = typeof item === 'string' ? item : item.segment
    if (/\p{Extended_Pictographic}/u.test(segment) || segment.includes('\uFE0F')) {
      length += 2
    } else {
      for (const char of segment) {
        const codePoint = char.codePointAt(0) ?? 0
        if (
          (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
          (codePoint >= 0x0300 && codePoint <= 0x036f)
        ) {
          continue
        }
        length += 1
      }
    }
  }

  return length
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

  return text.substring(0, maxWidth - 3) + '...'
}

export function wrapPlainText(text: string, maxWidth: number): string[] {
  if (!text) {
    return []
  }

  if (maxWidth <= 0 || getVisualLength(text) <= maxWidth) {
    return [text]
  }

  const lines: string[] = []
  let current = ''
  const words = text.split(' ')

  for (const word of words) {
    const candidate = (current + ' ' + word).trim()
    if (getVisualLength(candidate) > maxWidth) {
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
