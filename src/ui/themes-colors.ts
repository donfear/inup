import chalk from 'chalk'
import { getCurrentThemeName } from './state/theme-manager'

// Define actual color functions for each theme using hex colors
const themeColorSchemes = {
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
    versionRange: (text: string) => chalk.hex('#F1FA8C')(text), // Yellow
    versionLatest: (text: string) => chalk.hex('#FF5555')(text), // Red
    dot: (text: string) => chalk.hex('#50FA7B')(text), // Green
    dotEmpty: (text: string) => chalk.hex('#6272A4')(text), // Comment
  },
  vsc: {
    primary: (text: string) => chalk.hex('#569CD6')(text), // Blue
    secondary: (text: string) => chalk.hex('#4EC9B0')(text), // Cyan
    success: (text: string) => chalk.hex('#6A9955')(text), // Green
    warning: (text: string) => chalk.hex('#DCDCAA')(text), // Yellow
    error: (text: string) => chalk.hex('#F48771')(text), // Red
    border: (text: string) => chalk.hex('#858585')(text), // Gray
    text: (text: string) => chalk.hex('#D4D4D4')(text), // Foreground
    textSecondary: (text: string) => chalk.hex('#858585')(text), // Gray
    packageName: (text: string) => chalk.hex('#569CD6')(text), // Blue
    versionRange: (text: string) => chalk.hex('#DCDCAA')(text), // Yellow
    versionLatest: (text: string) => chalk.hex('#F48771')(text), // Red
    dot: (text: string) => chalk.hex('#6A9955')(text), // Green
    dotEmpty: (text: string) => chalk.hex('#858585')(text), // Gray
  },
  monokai: {
    primary: (text: string) => chalk.hex('#66D9EF')(text), // Cyan
    secondary: (text: string) => chalk.hex('#F92672')(text), // Pink
    success: (text: string) => chalk.hex('#A6E22E')(text), // Green
    warning: (text: string) => chalk.hex('#E6DB74')(text), // Yellow
    error: (text: string) => chalk.hex('#F92672')(text), // Red
    border: (text: string) => chalk.hex('#75715E')(text), // Comment
    text: (text: string) => chalk.hex('#F8F8F2')(text), // Foreground
    textSecondary: (text: string) => chalk.hex('#75715E')(text), // Comment
    packageName: (text: string) => chalk.hex('#66D9EF')(text), // Cyan
    versionRange: (text: string) => chalk.hex('#E6DB74')(text), // Yellow
    versionLatest: (text: string) => chalk.hex('#F92672')(text), // Red
    dot: (text: string) => chalk.hex('#A6E22E')(text), // Green
    dotEmpty: (text: string) => chalk.hex('#75715E')(text), // Comment
  },
  nord: {
    primary: (text: string) => chalk.hex('#88C0D0')(text), // Frost Cyan
    secondary: (text: string) => chalk.hex('#81A1C1')(text), // Frost Blue
    success: (text: string) => chalk.hex('#A3BE8C')(text), // Aurora Green
    warning: (text: string) => chalk.hex('#EBCB8B')(text), // Aurora Yellow
    error: (text: string) => chalk.hex('#BF616A')(text), // Aurora Red
    border: (text: string) => chalk.hex('#4C566A')(text), // Polar Night
    text: (text: string) => chalk.hex('#ECEFF4')(text), // Snow Storm
    textSecondary: (text: string) => chalk.hex('#D8DEE9')(text), // Snow Storm
    packageName: (text: string) => chalk.hex('#88C0D0')(text), // Frost Cyan
    versionRange: (text: string) => chalk.hex('#EBCB8B')(text), // Aurora Yellow
    versionLatest: (text: string) => chalk.hex('#BF616A')(text), // Aurora Red
    dot: (text: string) => chalk.hex('#A3BE8C')(text), // Aurora Green
    dotEmpty: (text: string) => chalk.hex('#4C566A')(text), // Polar Night
  },
  catppuccin: {
    primary: (text: string) => chalk.hex('#89B4FA')(text), // Blue
    secondary: (text: string) => chalk.hex('#CBA6F7')(text), // Mauve
    success: (text: string) => chalk.hex('#A6E3A1')(text), // Green
    warning: (text: string) => chalk.hex('#F9E2AF')(text), // Yellow
    error: (text: string) => chalk.hex('#F38BA8')(text), // Red
    border: (text: string) => chalk.hex('#585B70')(text), // Surface2
    text: (text: string) => chalk.hex('#CDD6F4')(text), // Text
    textSecondary: (text: string) => chalk.hex('#BAC2DE')(text), // Subtext1
    packageName: (text: string) => chalk.hex('#89B4FA')(text), // Blue
    versionRange: (text: string) => chalk.hex('#F9E2AF')(text), // Yellow
    versionLatest: (text: string) => chalk.hex('#F38BA8')(text), // Red
    dot: (text: string) => chalk.hex('#A6E3A1')(text), // Green
    dotEmpty: (text: string) => chalk.hex('#585B70')(text), // Surface2
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