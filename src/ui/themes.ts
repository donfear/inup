import chalk, { colors } from 'chalk'

export type ThemeColors = typeof chalk

export interface Theme {
  name: string
  colors: ThemeColors
}

const themesMetadata = {
  default: 'Default',
  catppuccin: 'Catppuccin',
  dracula: 'Dracula',
  vsc: 'VS Code',
  monokai: 'Monokai',
  tokyonight: 'Tokyo Night',
  onedark: 'One Dark',
}

// Theme definitions
export const themes: Record<string, Theme> = Object.entries(themesMetadata).reduce(
  (acc, [key, name]) => {
    acc[key] = {
      name,
      colors: chalk,
    }
    return acc
  },
  {} as Record<string, Theme>
)

export const defaultTheme = 'default'
export const themeNames = Object.keys(themes)
