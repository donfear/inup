import chalk from 'chalk'
import { themes, themeNames } from '../themes'

/**
 * Get the visual length of a string (ignoring ANSI color codes)
 * Accounts for wide characters like emojis
 */
function getVisualLength(str: string): number {
  const cleaned = str.replace(/\u001b\[[0-9;]*m/g, '')
  let length = 0
  for (const char of cleaned) {
    const code = char.charCodeAt(0)
    // Emoji ranges: 0x1F000–0x1F9FF (and other ranges)
    if (code >= 0x1F000 || code >= 0x2600) {
      length += 2
    } else {
      length += 1
    }
  }
  return length
}

/**
 * Render the theme selector modal
 */
export function renderThemeSelectorModal(
  currentTheme: string,
  previewTheme: string,
  terminalWidth: number = 80,
  terminalHeight: number = 24
): string[] {
  const maxModalWidth = 76 // Fixed width that fits comfortably in 80-char terminal
  const padding = Math.max(0, Math.floor((terminalWidth - maxModalWidth) / 2))
  const lines: string[] = []
  const contentWidth = maxModalWidth - 4 // Account for '│ ' on left and ' │' on right

  // Helper to pad content to exact width
  const createLine = (content: string): string => {
    const visualLen = getVisualLength(content)
    const spacesNeeded = Math.max(0, contentWidth - visualLen)
    const line = ' '.repeat(padding) + chalk.gray('│') + ' ' + content + ' '.repeat(spacesNeeded) + ' ' + chalk.gray('│')
    return line
  }

  // Top padding to center vertically
  const topPadding = Math.max(1, Math.floor((terminalHeight - themeNames.length - 8) / 2))
  for (let i = 0; i < topPadding; i++) {
    lines.push('')
  }

  // Top border
  lines.push(' '.repeat(padding) + chalk.gray('╭' + '─'.repeat(maxModalWidth - 2) + '╮'))

  // Title
  const title = chalk.cyan('🎨 Select Theme')
  lines.push(createLine(title))

  // Separator
  lines.push(' '.repeat(padding) + chalk.gray('├' + '─'.repeat(maxModalWidth - 2) + '┤'))

  // Theme options
  for (const themeName of themeNames) {
    const isSelected = themeName === previewTheme
    const isCurrent = themeName === currentTheme
    const themeObj = themes[themeName]

    // Build the theme line
    let themeLine = ''
    if (isSelected) {
      themeLine = chalk.green('● ')
    } else {
      themeLine = chalk.gray('○ ')
    }

    themeLine += themeObj.name

    if (isCurrent) {
      themeLine += chalk.gray(' (current)')
    }

    lines.push(createLine(themeLine))
  }

  // Separator before instructions
  lines.push(' '.repeat(padding) + chalk.gray('├' + '─'.repeat(maxModalWidth - 2) + '┤'))

  // Instructions
  const instruction = chalk.gray('↑/↓ to navigate • Enter to confirm • Esc to cancel')
  lines.push(createLine(instruction))

  // Bottom border
  lines.push(' '.repeat(padding) + chalk.gray('╰' + '─'.repeat(maxModalWidth - 2) + '╯'))

  return lines
}