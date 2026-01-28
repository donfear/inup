import chalk from 'chalk'
import { getCurrentThemeName } from './state/theme-manager'

// Centralized theme color definitions - single source of truth
const themeColorDefinitions = {
  default: {
    bg: '#1a1a1a',
    primary: 'cyan',
    secondary: 'magenta',
    success: 'green',
    warning: 'yellow',
    error: 'red',
    border: 'gray',
    text: 'white',
    textSecondary: 'gray',
  },
  dracula: {
    bg: '#1e1f26',
    primary: '#8BE9FD',
    secondary: '#FF79C6',
    success: '#50FA7B',
    warning: '#F1FA8C',
    error: '#FF5555',
    border: '#44475A',
    text: '#F8F8F2',
    textSecondary: '#6272A4',
  },
  vsc: {
    bg: '#1E1E1E',
    primary: '#4FC1FF',
    secondary: '#4EC9B0',
    success: '#89D185',
    warning: '#E5C07B',
    error: '#F48771',
    border: '#3E3E42',
    text: '#D4D4D4',
    textSecondary: '#858585',
  },
  monokai: {
    bg: '#272822',
    primary: '#66D9EF',
    secondary: '#AE81FF',
    success: '#A6E22E',
    warning: '#E6DB74',
    error: '#F92672',
    border: '#49483E',
    text: '#F8F8F2',
    textSecondary: '#75715E',
  },
  catppuccin: {
    bg: '#1E1E2E',
    primary: '#89B4FA',
    secondary: '#CBA6F7',
    success: '#A6E3A1',
    warning: '#F9E2AF',
    error: '#F38BA8',
    border: '#45475A',
    text: '#CDD6F4',
    textSecondary: '#BAC2DE',
  },
  tokyonight: {
    bg: '#1A1B26',
    primary: '#7AA2F7',
    secondary: '#BB9AF7',
    success: '#9ECE6A',
    warning: '#E0AF68',
    error: '#F7768E',
    border: '#414868',
    text: '#C0CAF5',
    textSecondary: '#A9B1D6',
  },
  onedark: {
    bg: '#282c34',
    primary: '#61AFEF',
    secondary: '#C678DD',
    success: '#98C379',
    warning: '#E5C07B',
    error: '#E06C75',
    border: '#3E4452',
    text: '#ABB2BF',
    textSecondary: '#5C6370',
  },
}

// Helper to apply color - handles both hex and named colors
function applyColor(color: string, text: string): string {
  if (color.startsWith('#')) {
    return chalk.hex(color)(text)
  }
  return (chalk as any)[color](text)
}

const themeColorSchemes: Record<
  keyof typeof themeColorDefinitions,
  Record<string, (text: string) => string>
> = Object.entries(themeColorDefinitions).reduce(
  (schemes, [themeName, colors]) => {
    schemes[themeName as keyof typeof themeColorDefinitions] = createThemeScheme(colors)
    return schemes
  },
  {} as Record<keyof typeof themeColorDefinitions, Record<string, (text: string) => string>>
)

function createThemeScheme(colors: typeof themeColorDefinitions.default) {
  return {
    primary: (text: string) => applyColor(colors.primary, text),
    secondary: (text: string) => applyColor(colors.secondary, text),
    success: (text: string) => applyColor(colors.success, text),
    warning: (text: string) => applyColor(colors.warning, text),
    error: (text: string) => applyColor(colors.error, text),
    border: (text: string) => applyColor(colors.border, text),
    text: (text: string) => applyColor(colors.text, text),
    textSecondary: (text: string) => applyColor(colors.textSecondary, text),
    // Derived colors (reuse existing colors for semantic purposes)
    packageName: (text: string) => applyColor(colors.primary, text),
    packageAuthor: (text: string) => applyColor(colors.secondary, text),
    versionRange: (text: string) => applyColor(colors.warning, text),
    versionLatest: (text: string) => applyColor(colors.error, text),
    dot: (text: string) => applyColor(colors.success, text),
    dotEmpty: (text: string) => applyColor(colors.border, text),
    bg: (text: string) => chalk.bgHex(colors.bg)(text),
  }
}

export type ThemeColorKey = keyof typeof themeColorSchemes.dracula
export type ThemeBgKey = 'bg'

export function getThemeColor(key: ThemeColorKey): (text: string) => string {
  const themeName = getCurrentThemeName() as keyof typeof themeColorSchemes
  const scheme = themeColorSchemes[themeName] || themeColorSchemes.dracula
  return scheme[key]
}

/**
 * Get the background color hex value for the current theme
 */
export function getThemeBgColor(): string {
  const themeName = getCurrentThemeName() as keyof typeof themeColorDefinitions
  return themeColorDefinitions[themeName]?.bg || themeColorDefinitions.dracula.bg
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 }
}

/**
 * Get ANSI escape code to set terminal background color
 */
export function getTerminalBgColorCode(): string {
  const hex = getThemeBgColor()
  const rgb = hexToRgb(hex)
  return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m`
}

/**
 * Get ANSI escape code to reset terminal colors
 */
export function getTerminalResetCode(): string {
  return '\x1b[0m'
}

export const themeColors = {
  primary: () => getThemeColor('primary'),
  secondary: () => getThemeColor('secondary'),
  success: () => getThemeColor('success'),
  warning: () => getThemeColor('warning'),
  error: () => getThemeColor('error'),
  border: () => getThemeColor('border'),
  text: () => getThemeColor('text'),
  textSecondary: () => getThemeColor('textSecondary'),
  packageName: () => getThemeColor('packageName'),
  versionRange: () => getThemeColor('versionRange'),
  versionLatest: () => getThemeColor('versionLatest'),
  dot: () => getThemeColor('dot'),
  dotEmpty: () => getThemeColor('dotEmpty'),
  bg: () => getThemeColor('bg'),
}
