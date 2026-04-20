import {
  AuditProgress,
  PackageLoadProgress,
  PackageSelectionState,
  RenderableItem,
  PackageManagerInfo,
} from '../../types'
import * as PackageList from './package-list'
import * as Confirmation from './confirmation'
import * as Modal from '../modal'
import { ModalRenderResult } from '../modal'
import { PackageListRenderOptions } from './package-list'

/**
 * Main UI renderer class that composes all rendering parts
 */
export class UIRenderer {
  renderPackageLine(
    state: PackageSelectionState,
    index: number,
    isCurrentRow: boolean,
    options?: PackageListRenderOptions
  ): string {
    return PackageList.renderPackageLine(state, index, isCurrentRow, 80, options)
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
    activeFilterLabel?: string,
    packageManager?: PackageManagerInfo,
    filterMode?: boolean,
    filterQuery?: string,
    totalPackagesBeforeFilter?: number,
    terminalWidth: number = 80,
    loadingProgress?: PackageLoadProgress,
    auditProgress?: AuditProgress,
    options?: PackageListRenderOptions
  ): string[] {
    return PackageList.renderInterface(
      states,
      currentRow,
      scrollOffset,
      maxVisibleItems,
      forceFullRender,
      renderableItems,
      activeFilterLabel,
      packageManager,
      filterMode,
      filterQuery,
      totalPackagesBeforeFilter,
      terminalWidth,
      loadingProgress,
      auditProgress,
      options
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
  ): ModalRenderResult {
    return Modal.renderPackageInfoLoading(state, terminalWidth, terminalHeight)
  }

  renderPackageInfoModal(
    state: PackageSelectionState,
    terminalWidth: number = 80,
    terminalHeight: number = 24,
    scrollOffset: number = 0,
    activeTab: 'info' | 'usedBy' = 'info'
  ): ModalRenderResult {
    return Modal.renderPackageInfoModal(
      state,
      terminalWidth,
      terminalHeight,
      scrollOffset,
      activeTab
    )
  }

  renderThemeSelectorModal(
    currentTheme: string,
    previewTheme: string,
    terminalWidth: number = 80,
    terminalHeight: number = 24
  ): string[] {
    return Modal.renderThemeSelectorModal(currentTheme, previewTheme, terminalWidth, terminalHeight)
  }
}

// Re-export all functions for direct use if needed
export * from './package-list'
export * from './confirmation'
export * from '../modal'
