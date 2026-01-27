import chalk from 'chalk'

export class VersionUtils {
  static applyVersionPrefix(originalSpecifier: string, targetVersion: string): string {
    // Extract prefix from original specifier (^ or ~)
    const prefixMatch = originalSpecifier.match(/^([^\d]+)/)
    const prefix = prefixMatch ? prefixMatch[1] : ''

    // Return target version with same prefix
    return prefix + targetVersion
  }

  static getVisualLength(str: string): number {
    // Strip ANSI escape codes to get visual length
    return str.replace(/\u001b\[[0-9;]*m/g, '').length
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
