import chalk from 'chalk'
import { getCurrentThemeName } from './state/theme-manager'

// Define actual color functions for each theme using hex colors
const themeColorSchemes = {
  default: {
    primary: (text: string) => chalk.cyan(text),
    secondary: (text: string) => chalk.magenta(text),
    success: (text: string) => chalk.green(text),
    warning: (text: string) => chalk.yellow(text),
    error: (text: string) => chalk.red(text),
    border: (text: string) => chalk.gray(text),
    text: (text: string) => chalk.white(text),
    textSecondary: (text: string) => chalk.gray(text),
    packageName: (text: string) => chalk.cyan(text),
    packageAuthor: (text: string) => chalk.white(text),
    versionRange: (text: string) => chalk.yellow(text),
    versionLatest: (text: string) => chalk.red(text),
    dot: (text: string) => chalk.green(text),
    dotEmpty: (text: string) => chalk.gray(text),
  },
  dracula: {
    primary: (text: string) => chalk.hex('#8BE9FD')(text), // Cyan
    secondary: (text: string) => chalk.hex('#FF79C6')(text), // Pink
    success: (text: string) => chalk.hex('#50FA7B')(text), // Green
    warning: (text: string) => chalk.hex('#F1FA8C')(text), // Yellow
    error: (text: string) => chalk.hex('#FF5555')(text), // Red
    border: (text: string) => chalk.hex('#6272A4')(text), // Comment
    text: (text: string) => chalk.hex('#F8F8F2')(text), // Foreground
    textSecondary: (text: string) => chalk.hex('#6272A4')(text), // Comment
    packageName: (text: string) => chalk.hex('#8BE9FD')(text), // Cyan
    packageAuthor: (text: string) => chalk.hex('#FF79C6')(text), // Pink
    versionRange: (text: string) => chalk.hex('#F1FA8C')(text), // Yellow
    versionLatest: (text: string) => chalk.hex('#FF5555')(text), // Red
    dot: (text: string) => chalk.hex('#50FA7B')(text), // Green
    dotEmpty: (text: string) => chalk.hex('#6272A4')(text), // Comment
  },
  vsc: {
    primary: (text: string) => chalk.hex('#4FC1FF')(text), // Brighter blue
    secondary: (text: string) => chalk.hex('#4EC9B0')(text), // Cyan (unchanged)
    success: (text: string) => chalk.hex('#89D185')(text), // Brighter green
    warning: (text: string) => chalk.hex('#E5C07B')(text), // Warmer yellow
    error: (text: string) => chalk.hex('#F48771')(text), // Red (unchanged)
    border: (text: string) => chalk.hex('#6E6E6E')(text), // Lighter gray
    text: (text: string) => chalk.hex('#D4D4D4')(text), // Foreground (unchanged)
    textSecondary: (text: string) => chalk.hex('#858585')(text), // Gray (unchanged)
    packageName: (text: string) => chalk.hex('#4FC1FF')(text), // Match primary
    packageAuthor: (text: string) => chalk.hex('#4EC9B0')(text), // Match secondary (cyan)
    versionRange: (text: string) => chalk.hex('#E5C07B')(text), // Match warning
    versionLatest: (text: string) => chalk.hex('#F48771')(text), // Match error
    dot: (text: string) => chalk.hex('#89D185')(text), // Match success
    dotEmpty: (text: string) => chalk.hex('#6E6E6E')(text), // Match border
  },
  monokai: {
    primary: (text: string) => chalk.hex('#66D9EF')(text), // Cyan (unchanged)
    secondary: (text: string) => chalk.hex('#AE81FF')(text), // Purple (better contrast)
    success: (text: string) => chalk.hex('#A6E22E')(text), // Green (unchanged)
    warning: (text: string) => chalk.hex('#E6DB74')(text), // Yellow (unchanged)
    error: (text: string) => chalk.hex('#F92672')(text), // Red (unchanged)
    border: (text: string) => chalk.hex('#75715E')(text), // Comment (unchanged)
    text: (text: string) => chalk.hex('#F8F8F2')(text), // Foreground (unchanged)
    textSecondary: (text: string) => chalk.hex('#75715E')(text), // Comment (unchanged)
    packageName: (text: string) => chalk.hex('#66D9EF')(text), // Cyan
    packageAuthor: (text: string) => chalk.hex('#AE81FF')(text), // Purple
    versionRange: (text: string) => chalk.hex('#E6DB74')(text), // Yellow
    versionLatest: (text: string) => chalk.hex('#F92672')(text), // Red
    dot: (text: string) => chalk.hex('#A6E22E')(text), // Green
    dotEmpty: (text: string) => chalk.hex('#75715E')(text), // Comment
  },
  catppuccin: {
    primary: (text: string) => chalk.hex('#89B4FA')(text), // Blue (unchanged)
    secondary: (text: string) => chalk.hex('#CBA6F7')(text), // Mauve (unchanged)
    success: (text: string) => chalk.hex('#A6E3A1')(text), // Green (unchanged)
    warning: (text: string) => chalk.hex('#F9E2AF')(text), // Yellow (unchanged)
    error: (text: string) => chalk.hex('#F38BA8')(text), // Red (unchanged)
    border: (text: string) => chalk.hex('#585B70')(text), // Surface2 (unchanged)
    text: (text: string) => chalk.hex('#CDD6F4')(text), // Text (unchanged)
    textSecondary: (text: string) => chalk.hex('#BAC2DE')(text), // Subtext1 (unchanged)
    packageName: (text: string) => chalk.hex('#89B4FA')(text), // Blue
    packageAuthor: (text: string) => chalk.hex('#CBA6F7')(text), // Mauve
    versionRange: (text: string) => chalk.hex('#F9E2AF')(text), // Yellow
    versionLatest: (text: string) => chalk.hex('#F38BA8')(text), // Red
    dot: (text: string) => chalk.hex('#A6E3A1')(text), // Green
    dotEmpty: (text: string) => chalk.hex('#585B70')(text), // Surface2
  },
  tokyonight: {
    primary: (text: string) => chalk.hex('#7AA2F7')(text), // Blue
    secondary: (text: string) => chalk.hex('#BB9AF7')(text), // Purple
    success: (text: string) => chalk.hex('#9ECE6A')(text), // Green
    warning: (text: string) => chalk.hex('#E0AF68')(text), // Yellow
    error: (text: string) => chalk.hex('#F7768E')(text), // Red
    border: (text: string) => chalk.hex('#565F89')(text), // Comment
    text: (text: string) => chalk.hex('#C0CAF5')(text), // Foreground
    textSecondary: (text: string) => chalk.hex('#9AA5CE')(text),
    packageName: (text: string) => chalk.hex('#7AA2F7')(text),
    packageAuthor: (text: string) => chalk.hex('#BB9AF7')(text),
    versionRange: (text: string) => chalk.hex('#E0AF68')(text),
    versionLatest: (text: string) => chalk.hex('#F7768E')(text),
    dot: (text: string) => chalk.hex('#9ECE6A')(text),
    dotEmpty: (text: string) => chalk.hex('#565F89')(text),
  },
  onedark: {
    primary: (text: string) => chalk.hex('#61AFEF')(text), // Blue
    secondary: (text: string) => chalk.hex('#C678DD')(text), // Purple
    success: (text: string) => chalk.hex('#98C379')(text), // Green
    warning: (text: string) => chalk.hex('#E5C07B')(text), // Yellow
    error: (text: string) => chalk.hex('#E06C75')(text), // Red
    border: (text: string) => chalk.hex('#5C6370')(text), // Gutter
    text: (text: string) => chalk.hex('#ABB2BF')(text), // Foreground
    textSecondary: (text: string) => chalk.hex('#828997')(text),
    packageName: (text: string) => chalk.hex('#61AFEF')(text),
    packageAuthor: (text: string) => chalk.hex('#C678DD')(text),
    versionRange: (text: string) => chalk.hex('#E5C07B')(text),
    versionLatest: (text: string) => chalk.hex('#E06C75')(text),
    dot: (text: string) => chalk.hex('#98C379')(text),
    dotEmpty: (text: string) => chalk.hex('#5C6370')(text),
  },
}

export type ThemeColorKey = keyof typeof themeColorSchemes.dracula

export function getThemeColor(key: ThemeColorKey): (text: string) => string {
  const themeName = getCurrentThemeName() as keyof typeof themeColorSchemes
  const scheme = themeColorSchemes[themeName] || themeColorSchemes.dracula
  return scheme[key]
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
}
