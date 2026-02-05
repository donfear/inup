import chalk from 'chalk'

/**
 * ANSI escape code pattern for stripping terminal colors
 */
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

export class VersionUtils {
  static applyVersionPrefix(originalSpecifier: string, targetVersion: string): string {
    // Extract prefix from original specifier (^ or ~)
    const prefixMatch = originalSpecifier.match(/^([^\d]+)/)
    const prefix = prefixMatch ? prefixMatch[1] : ''

    // Return target version with same prefix
    return prefix + targetVersion
  }

  /**
   * Strip ANSI escape codes from a string
   */
  static stripAnsi(str: string): string {
    return str.replace(ANSI_PATTERN, '')
  }

  /**
   * Get the visual length of a string (excluding ANSI codes)
   */
  static getVisualLength(str: string): number {
    return VersionUtils.stripAnsi(str).length
  }

  /**
   * Truncate text with ellipsis in the middle if it exceeds maxLength
   * Preserves ANSI color codes and applies them to the ellipsis
   * @param str The text to truncate (may contain ANSI codes)
   * @param maxLength The maximum visual length
   * @returns Truncated text with middle ellipsis if needed
   */
  static truncateMiddle(str: string, maxLength: number): string {
    const visualLength = this.getVisualLength(str)

    if (visualLength <= maxLength) {
      return str
    }

    // Need to truncate with ellipsis in the middle
    const ellipsis = '…'
    const availableLength = maxLength - 1 // Reserve 1 char for ellipsis
    const startLength = Math.ceil(availableLength / 2)
    const endLength = Math.floor(availableLength / 2)

    // Extract raw text without ANSI codes to calculate positions
    const rawText = VersionUtils.stripAnsi(str)

    const start = rawText.substring(0, startLength)
    const end = rawText.substring(rawText.length - endLength)

    return start + ellipsis + end
  }

  static formatVersionDiff(
    current: string,
    target: string,
    colorFn: (text: string) => string
  ): string {
    if (current === target) {
      return chalk.white(target)
    }

    // Parse semantic versions into parts
    const currentParts = current.split('.').map((part) => parseInt(part) || 0)
    const targetParts = target.split('.').map((part) => parseInt(part) || 0)

    // Find the first differing version segment (major, minor, or patch)
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
      // Versions are identical (shouldn't happen due to guard above, but just in case)
      return chalk.white(target)
    }

    // Build the result with proper coloring
    const result: string[] = []

    for (let i = 0; i < maxLength; i++) {
      const targetPart = targetParts[i] || 0
      const partStr = targetPart.toString()

      if (i < firstDiffSegment) {
        // Unchanged segment - keep white
        result.push(partStr)
      } else {
        // Changed segment or later - apply color
        result.push(colorFn(partStr))
      }

      // Add dot separator if not the last part
      if (i < maxLength - 1) {
        // Color the dot the same as the following part
        const nextPartColor = i + 1 < firstDiffSegment ? chalk.white : colorFn
        result.push(nextPartColor('.'))
      }
    }

    return result.join('')
  }
}
