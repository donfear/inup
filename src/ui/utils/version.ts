import chalk from 'chalk'
import { stripAnsi, getVisualLength } from '../../shared/terminal/text'
import { applyVersionPrefix } from '../../shared/versions'

export { stripAnsi, getVisualLength, applyVersionPrefix }

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

export function formatVersionDiff(
  current: string,
  target: string,
  colorFn: (text: string) => string
): string {
  if (current === target) {
    return chalk.white(target)
  }

  const currentParts = current.split('.').map((part) => parseInt(part) || 0)
  const targetParts = target.split('.').map((part) => parseInt(part) || 0)

  let firstDiffSegment = -1
  const maxLength = Math.max(currentParts.length, targetParts.length)

  for (let i = 0; i < maxLength; i++) {
    const currentPart = currentParts[i] || 0
    const targetPart = targetParts[i] || 0

    if (currentPart !== targetPart) {
      firstDiffSegment = i
      break
    }
  }

  if (firstDiffSegment === -1) {
    return chalk.white(target)
  }

  const result: string[] = []

  for (let i = 0; i < maxLength; i++) {
    const targetPart = targetParts[i] || 0
    const partStr = targetPart.toString()

    if (i < firstDiffSegment) {
      result.push(partStr)
    } else {
      result.push(colorFn(partStr))
    }

    if (i < maxLength - 1) {
      const nextPartColor = i + 1 < firstDiffSegment ? chalk.white : colorFn
      result.push(nextPartColor('.'))
    }
  }

  return result.join('')
}

export const VersionUtils = {
  applyVersionPrefix,
  truncateMiddle,
  formatVersionDiff,
  stripAnsi,
  getVisualLength,
}
