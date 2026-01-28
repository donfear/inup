import { PackageSelectionState, RenderableItem, PackageManagerInfo } from '../../types'
import * as PackageList from './package-list'
import * as Confirmation from './confirmation'
import * as Modal from './modal'
import * as ThemeSelector from './theme-selector'

/**
 * Main UI renderer class that composes all rendering parts
 */
export class UIRenderer {
  renderPackageLine(state: PackageSelectionState, index: number, isCurrentRow: boolean): string {
    return PackageList.renderPackageLine(state, index, isCurrentRow)
  }

  renderSectionHeader(title: string, sectionType: 'main' | 'peer' | 'optional'): string {
    return PackageList.renderSectionHeader(title, sectionType)
  }

  renderSpacer(): string {
    return PackageList.renderSpacer()
  }

  renderInterface(
    states: PackageSelectionState[],
    currentRow: number,
    scrollOffset: number,
    maxVisibleItems: number,
    forceFullRender: boolean,
    renderableItems?: RenderableItem[],
    dependencyTypeLabel?: string,
    packageManager?: PackageManagerInfo,
    filterMode?: boolean,
    filterQuery?: string,
    totalPackagesBeforeFilter?: number,
    terminalWidth: number = 80
  ): string[] {
    return PackageList.renderInterface(
      states,
      currentRow,
      scrollOffset,
      maxVisibleItems,
      forceFullRender,
      renderableItems,
      dependencyTypeLabel,
      packageManager,
      filterMode,
      filterQuery,
      totalPackagesBeforeFilter,
      terminalWidth
    )
  }

  renderPackagesTable(packages: any[]): string {
    return PackageList.renderPackagesTable(packages)
  }

  renderConfirmation(choices: any[]): string {
    return Confirmation.renderConfirmation(choices)
  }

  renderPackageInfoLoading(
    state: PackageSelectionState,
    terminalWidth: number = 80,
    terminalHeight: number = 24
  ): string[] {
    return Modal.renderPackageInfoLoading(state, terminalWidth, terminalHeight)
  }

  renderPackageInfoModal(
    state: PackageSelectionState,
    terminalWidth: number = 80,
    terminalHeight: number = 24
  ): string[] {
    return Modal.renderPackageInfoModal(state, terminalWidth, terminalHeight)
  }

  renderThemeSelectorModal(
    currentTheme: string,
    previewTheme: string,
    terminalWidth: number = 80,
    terminalHeight: number = 24
  ): string[] {
    return ThemeSelector.renderThemeSelectorModal(currentTheme, previewTheme, terminalWidth, terminalHeight)
  }
}

// Re-export all functions for direct use if needed
export * from './package-list'
export * from './confirmation'
export * from './modal'
export * from './theme-selector'
