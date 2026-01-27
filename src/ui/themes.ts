import chalk from 'chalk'

export type ThemeColors = typeof chalk

export interface Theme {
  name: string
  colors: ThemeColors
}

// Theme definitions
export const themes: Record<string, Theme> = {
  dracula: {
    name: 'Dracula',
    colors: chalk,
  },
  vsc: {
    name: 'VS Code',
    colors: chalk,
  },
  monokai: {
    name: 'Monokai',
    colors: chalk,
  },
  nord: {
    name: 'Nord',
    colors: chalk,
  },
}

export const defaultTheme = 'dracula'
export const themeNames = Object.keys(themes)
