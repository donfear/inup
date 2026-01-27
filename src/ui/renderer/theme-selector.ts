import chalk from 'chalk'
import { themes, themeNames } from '../themes'

/**
 * Remove ANSI color codes from a string for length calculation
 */
function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*m/g, '')
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
  const modalWidth = Math.min(terminalWidth - 6, 80)
  const padding = Math.floor((terminalWidth - modalWidth) / 2)
  const lines: string[] = []

  // Top padding to center vertically
  const topPadding = Math.max(1, Math.floor((terminalHeight - themeNames.length - 8) / 2))
  for (let i = 0; i < topPadding; i++) {
    lines.push('')
  }

  // Top border
  lines.push(' '.repeat(padding) + chalk.gray('╭' + '─'.repeat(modalWidth - 2) + '╮'))

  // Title
  const title = '🎨 Select Theme'
  const titlePadding = modalWidth - 4 - stripAnsi(title).length
  lines.push(
    ' '.repeat(padding) +
      chalk.gray('│') +
      ' ' +
      chalk.cyan(title) +
      ' '.repeat(Math.max(0, titlePadding)) +
      chalk.gray('│')
  )

  // Separator
  lines.push(' '.repeat(padding) + chalk.gray('├' + '─'.repeat(modalWidth - 2) + '┤'))

  // Theme options
  for (const themeName of themeNames) {
    const isSelected = themeName === previewTheme
    const isCurrent = themeName === currentTheme
    const themeObj = themes[themeName]

    // Build the theme line
    let themeLine = ''
    if (isSelected) {
      themeLine = chalk.green('● ') // Selected
    } else {
      themeLine = chalk.gray('○ ')
    }

    themeLine += themeObj.name
    if (isCurrent) {
      themeLine += chalk.gray(' (current)')
    }

    const linePadding = modalWidth - 4 - stripAnsi(themeLine).length
    lines.push(
      ' '.repeat(padding) +
        chalk.gray('│') +
        ' ' +
        themeLine +
        ' '.repeat(Math.max(0, linePadding)) +
        chalk.gray('│')
    )
  }

  // Separator before instructions
  lines.push(' '.repeat(padding) + chalk.gray('├' + '─'.repeat(modalWidth - 2) + '┤'))

  // Instructions
  const instructions = ['↑/↓ to navigate • Enter to confirm • Esc to cancel']
  for (const instruction of instructions) {
    const instPadding = modalWidth - 4 - stripAnsi(instruction).length
    lines.push(
      ' '.repeat(padding) +
        chalk.gray('│') +
        ' ' +
        chalk.gray(instruction) +
        ' '.repeat(Math.max(0, instPadding)) +
        chalk.gray('│')
    )
  }

  // Bottom border
  lines.push(' '.repeat(padding) + chalk.gray('╰' + '─'.repeat(modalWidth - 2) + '╯'))

  return lines
}
