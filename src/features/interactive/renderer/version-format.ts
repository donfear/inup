import { getVisualLength, stripAnsi } from '../../../shared/terminal/text'
import { applyVersionPrefix } from '../../../shared/versions'

export { applyVersionPrefix, getVisualLength, stripAnsi }

export function truncateMiddle(str: string, maxLength: number): string {
  const visualLength = getVisualLength(str)

  if (visualLength <= maxLength) {
    return str
  }

  const ellipsis = '…'
  const availableLength = maxLength - 1
  const startLength = Math.ceil(availableLength / 2)
  const endLength = Math.floor(availableLength / 2)

  const rawText = stripAnsi(str)
  const start = rawText.substring(0, startLength)
  const end = rawText.substring(rawText.length - endLength)

  return start + ellipsis + end
}

export const VersionUtils = {
  applyVersionPrefix,
  truncateMiddle,
  stripAnsi,
  getVisualLength,
}
