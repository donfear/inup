import chalk from 'chalk'

export type ThemeColors = typeof chalk

// Theme switching is currently label-only; all themes share the same chalk instance.
export interface Theme {
  name: string
  colors: ThemeColors
}

export const themes: Record<string, Theme> = {
  default: { name: 'Default', colors: chalk },
  catppuccin: { name: 'Catppuccin', colors: chalk },
  dracula: { name: 'Dracula', colors: chalk },
  vsc: { name: 'VS Code', colors: chalk },
  monokai: { name: 'Monokai', colors: chalk },
  tokyonight: { name: 'Tokyo Night', colors: chalk },
  onedark: { name: 'One Dark', colors: chalk },
  gruvbox: { name: 'Gruvbox', colors: chalk },
  solarized: { name: 'Solarized', colors: chalk },
  github: { name: 'GitHub', colors: chalk },
}

export const defaultTheme = 'default'
export const themeNames = Object.keys(themes)
