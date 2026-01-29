import { themes, defaultTheme, themeNames } from '../themes'
import { configManager } from '../../utils/config'

export interface ThemeState {
  showThemeModal: boolean
  currentTheme: string
  previewTheme: string // Theme being previewed before confirmation
}

// Global theme state for renderers to access
let globalCurrentTheme = defaultTheme

export class ThemeManager {
  private state: ThemeState

  constructor() {
    // Load saved theme from config, fallback to default
    const savedTheme = configManager.getTheme()
    const initialTheme = savedTheme && themeNames.includes(savedTheme) ? savedTheme : defaultTheme

    this.state = {
      showThemeModal: false,
      currentTheme: initialTheme,
      previewTheme: initialTheme,
    }
    globalCurrentTheme = initialTheme
  }

  getState(): ThemeState {
    return { ...this.state }
  }

  isThemeModalOpen(): boolean {
    return this.state.showThemeModal
  }

  getCurrentTheme(): string {
    return this.state.currentTheme
  }

  getPreviewTheme(): string {
    return this.state.previewTheme
  }

  openThemeModal(): void {
    this.state.showThemeModal = true
    // Start preview with current theme
    this.state.previewTheme = this.state.currentTheme
  }

  closeThemeModal(): void {
    this.state.showThemeModal = false
    // Reset preview to current theme when closing without confirmation
    this.state.previewTheme = this.state.currentTheme
    // Restore global theme to confirmed theme when canceling
    globalCurrentTheme = this.state.currentTheme
  }

  previewTheme(themeName: string): void {
    if (themeNames.includes(themeName)) {
      this.state.previewTheme = themeName
      // Update global theme immediately for live preview in UI
      globalCurrentTheme = themeName
    }
  }

  confirmTheme(): void {
    this.state.currentTheme = this.state.previewTheme
    globalCurrentTheme = this.state.currentTheme
    // Save theme to config
    configManager.setTheme(this.state.currentTheme)
    this.closeThemeModal()
  }

  setTheme(themeName: string): void {
    if (themeNames.includes(themeName)) {
      this.state.currentTheme = themeName
      this.state.previewTheme = themeName
      globalCurrentTheme = themeName
      // Save theme to config
      configManager.setTheme(themeName)
    }
  }

  toggleThemeModal(): void {
    if (this.state.showThemeModal) {
      this.closeThemeModal()
    } else {
      this.openThemeModal()
    }
  }
}

// Helper function for renderers to get current theme colors
export function getThemeColors() {
  return themes[globalCurrentTheme]?.colors || themes[defaultTheme].colors
}

// Helper function to get current theme name
export function getCurrentThemeName() {
  return globalCurrentTheme
}
