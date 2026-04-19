import chalk from 'chalk'
import { themes, themeNames } from '../themes'
import { ModalSection } from './types'
import { renderModalFrame } from './layout'

export function renderThemeSelectorModal(
  currentTheme: string,
  previewTheme: string,
  terminalWidth: number = 80,
  terminalHeight: number = 24
): string[] {
  const themeRows = themeNames.map((themeName) => {
    const isSelected = themeName === previewTheme
    const isCurrent = themeName === currentTheme
    const themeObj = themes[themeName]

    let themeLine = isSelected ? chalk.green('● ') : chalk.gray('○ ')
    themeLine += themeObj.name

    if (isCurrent) {
      themeLine += chalk.gray(' (current)')
    }

    return themeLine
  })

  const sections: ModalSection[] = [
    {
      key: 'header',
      rows: [chalk.cyan('🎨 Select Theme')],
      required: true,
    },
    {
      key: 'themes',
      rows: themeRows,
      required: true,
    },
    {
      key: 'instructions',
      rows: [chalk.gray('↑/↓ to navigate • Enter to confirm • Esc to cancel')],
      required: true,
    },
  ]

  return renderModalFrame(sections, {
    terminalWidth,
    terminalHeight,
    minWidth: 76,
    maxWidth: 76,
  })
}
