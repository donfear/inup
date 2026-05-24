import chalk from 'chalk'
import * as semver from 'semver'
import {
  PackageLoadProgress,
  PackageInfo,
  PackageUpgradeChoice,
  PackageSelectionState,
  PackageManagerInfo,
  StreamOutdatedPackagesBatchItem,
  VulnerabilityDisplayOptions,
} from './types'
import { Key } from 'node:readline'
import {
  StateManager,
  UIRenderer,
  InputHandler,
  ConfirmationInputHandler,
  InputAction,
  VersionUtils,
  CursorUtils,
  ConsoleUtils,
  TerminalInput,
} from './ui'
import { PackageInfoModalController, VulnerabilityAuditController } from './ui/controllers'
import { PackageListRenderOptions } from './ui/renderer/package-list'
import { themeNames, themes, getTerminalBgColorCode, getTerminalResetCode, coloredInupLogo } from './ui'
import { getPerformanceTracker, renderPerformanceModal } from './features/debug'

type InteractiveUIOptions = VulnerabilityDisplayOptions

const DEFAULT_VULNERABILITY_DISPLAY_OPTIONS: Required<VulnerabilityDisplayOptions> = {
  showPeerDependencyVulnerabilities: false,
  showOptionalDependencyVulnerabilities: false,
}

function normalizeVulnerabilityDisplayOptions(
  options?: VulnerabilityDisplayOptions
): Required<VulnerabilityDisplayOptions> {
  return {
    showPeerDependencyVulnerabilities:
      options?.showPeerDependencyVulnerabilities ??
      DEFAULT_VULNERABILITY_DISPLAY_OPTIONS.showPeerDependencyVulnerabilities,
    showOptionalDependencyVulnerabilities:
      options?.showOptionalDependencyVulnerabilities ??
      DEFAULT_VULNERABILITY_DISPLAY_OPTIONS.showOptionalDependencyVulnerabilities,
  }
}

export class InteractiveUI {
  private renderer: UIRenderer
  private packageManager: PackageManagerInfo
  private readonly options: Required<InteractiveUIOptions>
  private readonly vulnerabilityAuditController = new VulnerabilityAuditController()
  private readonly packageInfoModalController = new PackageInfoModalController()
  private refreshView?: () => void

  constructor(packageManager: PackageManagerInfo, options?: InteractiveUIOptions) {
    this.renderer = new UIRenderer()
    this.packageManager = packageManager
    this.options = normalizeVulnerabilityDisplayOptions(options)
  }

  public async displayPackagesTable(packages: PackageInfo[]): Promise<void> {
    console.log(this.renderer.renderPackagesTable(packages))
  }

  public async selectPackagesToUpgrade(
    packages: PackageInfo[],
    previousSelections?: Map<string, 'none' | 'range' | 'latest'>
  ): Promise<PackageUpgradeChoice[]> {
    const selectionStates = this.createSelectionStates(packages, previousSelections, false)
    if (selectionStates.length === 0) {
      return []
    }

    const selectedStates = await this.interactiveTableSelector(selectionStates)
    return this.createUpgradeChoices(selectedStates)
  }

  public createSelectionStates(
    packages: PackageInfo[],
    previousSelections?: Map<string, 'none' | 'range' | 'latest'>,
    includeUpToDate: boolean = true
  ): PackageSelectionState[] {
    const relevantPackages = includeUpToDate ? packages : packages.filter((p) => p.isOutdated)
    const uniquePackages = this.deduplicatePackages(relevantPackages)

    return Array.from(uniquePackages.values()).map(({ pkg, packageJsonPaths }) => {
      const currentClean = semver.coerce(pkg.currentVersion)?.version || pkg.currentVersion
      const rangeClean = semver.coerce(pkg.rangeVersion)?.version || pkg.rangeVersion
      const latestClean = semver.coerce(pkg.latestVersion)?.version || pkg.latestVersion
      const key = `${pkg.name}@${pkg.currentVersion}@${pkg.type}`
      const previousSelection = previousSelections?.get(key) || 'none'

      return {
        name: pkg.name,
        packageJsonPath: pkg.packageJsonPath,
        packageJsonPaths: Array.from(packageJsonPaths),
        currentVersionSpecifier: pkg.currentVersion,
        currentVersion: currentClean,
        rangeVersion: rangeClean,
        latestVersion: latestClean,
        selectedOption: previousSelection,
        loadState: 'ready',
        hasRangeUpdate: pkg.hasRangeUpdate,
        hasMajorUpdate: pkg.hasMajorUpdate,
        type: pkg.type,
        vulnerability: this.vulnerabilityAuditController.getCachedSummary(
          pkg.name,
          pkg.currentVersion,
          pkg.type
        ),
        allVersions: pkg.allVersions,
      }
    })
  }

  public createPendingSelectionStates(
    packages: Array<Pick<PackageInfo, 'name' | 'currentVersion' | 'type' | 'packageJsonPath'>>,
    previousSelections?: Map<string, 'none' | 'range' | 'latest'>
  ): PackageSelectionState[] {
    const uniquePackages = this.deduplicatePackages(
      packages.map((pkg) => ({
        ...pkg,
        rangeVersion: pkg.currentVersion,
        latestVersion: pkg.currentVersion,
        isOutdated: false,
        hasRangeUpdate: false,
        hasMajorUpdate: false,
      }))
    )

    return Array.from(uniquePackages.values()).map(({ pkg, packageJsonPaths }) => {
      const currentClean = semver.coerce(pkg.currentVersion)?.version || pkg.currentVersion
      const key = `${pkg.name}@${pkg.currentVersion}@${pkg.type}`
      const previousSelection = previousSelections?.get(key) || 'none'

      return {
        name: pkg.name,
        packageJsonPath: pkg.packageJsonPath,
        packageJsonPaths: Array.from(packageJsonPaths),
        currentVersionSpecifier: pkg.currentVersion,
        currentVersion: currentClean,
        rangeVersion: 'loading',
        latestVersion: 'loading',
        selectedOption: previousSelection,
        loadState: 'pending',
        hasRangeUpdate: false,
        hasMajorUpdate: false,
        type: pkg.type,
        vulnerability: this.vulnerabilityAuditController.getCachedSummary(
          pkg.name,
          pkg.currentVersion,
          pkg.type
        ),
      }
    })
  }

  public appendOutdatedBatchToSelectionStates(
    selectionStates: PackageSelectionState[],
    batch: StreamOutdatedPackagesBatchItem[],
    previousSelections?: Map<string, 'none' | 'range' | 'latest'>
  ): void {
    const outdatedStates = this.createSelectionStates(
      batch.flatMap((batchItem) => batchItem.packageInfo).filter((pkg) => pkg.isOutdated),
      previousSelections,
      false
    )

    if (outdatedStates.length === 0) {
      return
    }

    const seen = new Set(
      selectionStates.map((state) => `${state.name}@${state.currentVersionSpecifier}@${state.type}`)
    )

    outdatedStates.forEach((state) => {
      const key = `${state.name}@${state.currentVersionSpecifier}@${state.type}`
      if (!seen.has(key)) {
        selectionStates.push(state)
        seen.add(key)
      }
    })

    this.enqueueSecurityAudit(selectionStates)
  }

  public async selectPackagesToUpgradeProgressive(
    selectionStates: PackageSelectionState[],
    progress: PackageLoadProgress,
    attachRefresh: (refresh: () => void) => void
  ): Promise<PackageUpgradeChoice[]> {
    this.enqueueSecurityAudit(selectionStates)
    const selectedStates = await this.interactiveTableSelector(
      selectionStates,
      progress,
      attachRefresh
    )
    return this.createUpgradeChoices(selectedStates)
  }

  public enqueueSecurityAudit(selectionStates: PackageSelectionState[]): void {
    this.vulnerabilityAuditController.enqueueStates(selectionStates, () => this.refreshView?.())
  }

  private deduplicatePackages(
    packages: PackageInfo[]
  ): Map<string, { pkg: PackageInfo; packageJsonPaths: Set<string> }> {
    const uniquePackages = new Map<string, { pkg: PackageInfo; packageJsonPaths: Set<string> }>()

    for (const pkg of packages) {
      const key = `${pkg.name}@${pkg.currentVersion}@${pkg.type}`
      if (!uniquePackages.has(key)) {
        uniquePackages.set(key, {
          pkg,
          packageJsonPaths: new Set([pkg.packageJsonPath]),
        })
      } else {
        uniquePackages.get(key)!.packageJsonPaths.add(pkg.packageJsonPath)
      }
    }

    return new Map(
      Array.from(uniquePackages.entries()).sort(([, a], [, b]) => {
        const aIsScoped = a.pkg.name.startsWith('@')
        const bIsScoped = b.pkg.name.startsWith('@')
        if (aIsScoped && !bIsScoped) return -1
        if (!aIsScoped && bIsScoped) return 1
        return a.pkg.name.localeCompare(b.pkg.name)
      })
    )
  }

  private createUpgradeChoices(selectedStates: PackageSelectionState[]): PackageUpgradeChoice[] {
    const choices: PackageUpgradeChoice[] = []
    selectedStates
      .filter((state) => state.loadState === 'ready' && state.selectedOption !== 'none')
      .forEach((state) => {
        const targetVersion =
          state.selectedOption === 'range' ? state.rangeVersion : state.latestVersion
        const targetVersionWithPrefix = VersionUtils.applyVersionPrefix(
          state.currentVersionSpecifier,
          targetVersion
        )

        const pathsToUpdate = state.packageJsonPaths || [state.packageJsonPath]
        pathsToUpdate.forEach((packageJsonPath) => {
          choices.push({
            name: state.name,
            packageJsonPath,
            dependencyType: state.type,
            upgradeType: state.selectedOption,
            targetVersion: targetVersionWithPrefix,
            currentVersionSpecifier: state.currentVersionSpecifier,
          })
        })
      })

    return choices
  }

  private getTerminalHeight(): number {
    // Check if stdout is a TTY and has rows property
    if (
      process.stdout.isTTY &&
      typeof process.stdout.rows === 'number' &&
      process.stdout.rows > 0
    ) {
      return process.stdout.rows
    }
    return 24 // Fallback default
  }

  private async interactiveTableSelector(
    selectionStates: PackageSelectionState[],
    loadingProgress?: PackageLoadProgress,
    attachRefresh?: (refresh: () => void) => void
  ): Promise<PackageSelectionState[]> {
    return new Promise((resolve) => {
      const states = selectionStates
      const stateManager = new StateManager(0, this.getTerminalHeight())
      let isResolved = false
      let ownsAlternateScreen = false
      const vulnerabilityDisplayOptions: VulnerabilityDisplayOptions = this.options

      const claimInteractiveScreen = () => {
        if (ownsAlternateScreen) {
          return
        }

        ConsoleUtils.clearProgress()
        CursorUtils.enterAlternateScreen()
        CursorUtils.clearScreen()
        ownsAlternateScreen = true
      }

      const releaseInteractiveScreen = () => {
        if (!ownsAlternateScreen) {
          return
        }

        CursorUtils.exitAlternateScreen()
        ownsAlternateScreen = false
      }

      // No grouping needed - packages are already filtered by type
      // This simplifies scrolling and avoids rendering issues
      stateManager.setRenderableItems([])

      // Track the current max scroll offset for the info modal
      let infoModalMaxScrollOffset = 0
      // Track the current max scroll offset for the debug modal
      let debugModalMaxScrollOffset = 0
      let previousViewportMode: 'list' | 'info-modal' | 'theme-modal' | null = null
      let previousModalViewportLineCount: number | null = null
      const handleAction = (action: InputAction) => {
        const uiState = stateManager.getUIState()
        const filteredStates = stateManager.getFilteredStates(states, vulnerabilityDisplayOptions)

        switch (action.type) {
          case 'navigate_up':
            if (!uiState.showThemeModal) {
              stateManager.navigateUp(filteredStates.length)
            }
            break
          case 'navigate_down':
            if (!uiState.showThemeModal) {
              stateManager.navigateDown(filteredStates.length)
            }
            break
          case 'select_left':
            if (!uiState.showThemeModal) {
              stateManager.updateSelection(filteredStates, 'left')
            }
            break
          case 'select_right':
            if (!uiState.showThemeModal) {
              stateManager.updateSelection(filteredStates, 'right')
            }
            break
          case 'bulk_select_minor':
            if (!uiState.showThemeModal) {
              stateManager.bulkSelectMinor(filteredStates)
            }
            break
          case 'bulk_select_latest':
            if (!uiState.showThemeModal) {
              stateManager.bulkSelectLatest(filteredStates)
            }
            break
          case 'bulk_unselect_all':
            if (!uiState.showThemeModal) {
              stateManager.bulkUnselectAll(filteredStates)
            }
            break
          case 'toggle_dep_type_filter':
            if (!uiState.showThemeModal) {
              stateManager.toggleDependencyTypeFilter(action.depType)
            }
            break
          case 'toggle_info_modal':
            if (!uiState.showInfoModal) {
              // Opening modal - load package info asynchronously
              const modalSessionId = stateManager.toggleInfoModal()
              const currentState = filteredStates[uiState.currentRow]
              const canFetchMetadata = currentState?.loadState === 'ready'
              stateManager.setModalLoading(canFetchMetadata, modalSessionId)
              renderInterface()

              if (currentState && canFetchMetadata) {
                this.packageInfoModalController
                  .hydrate(currentState)
                  .then(() => {
                    if (isResolved || stateManager.getInfoModalSessionId() !== modalSessionId)
                      return

                    stateManager.setModalLoading(false, modalSessionId)
                    renderInterface()

                    // Auto-load the first version's release notes
                    if (
                      stateManager.getInfoModalSessionId() === modalSessionId &&
                      this.packageInfoModalController.getVersionCount(currentState) > 0
                    ) {
                      this.packageInfoModalController.loadVersionAtIndex(currentState, 0, () => {
                        if (!isResolved) renderInterface()
                      })
                    }
                  })
                  .catch(() => {
                    if (isResolved || stateManager.getInfoModalSessionId() !== modalSessionId)
                      return
                    stateManager.setModalLoading(false, modalSessionId)
                    renderInterface()
                  })
              }
            } else {
              // Closing modal - cancel in-flight fetches
              this.packageInfoModalController.cancel()
              stateManager.toggleInfoModal()
              renderInterface()
            }
            break
          case 'scroll_info_modal_up':
            if (!stateManager.scrollInfoModalUp()) {
              return
            }
            break
          case 'scroll_info_modal_down':
            if (!stateManager.scrollInfoModalDown(infoModalMaxScrollOffset)) {
              return
            }
            break
          case 'toggle_debug_modal':
            stateManager.toggleDebugModal()
            break
          case 'scroll_debug_modal_up':
            if (!stateManager.scrollDebugModalUp()) {
              return
            }
            break
          case 'scroll_debug_modal_down':
            if (!stateManager.scrollDebugModalDown(debugModalMaxScrollOffset)) {
              return
            }
            break
          case 'switch_info_modal_tab': {
            const nextTab = stateManager.getInfoModalTab() === 'info' ? 'usedBy' : 'info'
            stateManager.setInfoModalTab(nextTab)
            break
          }
          case 'navigate_info_modal_version':
            {
              if (uiState.infoModalRow >= 0 && uiState.infoModalRow < filteredStates.length) {
                const currentState = filteredStates[uiState.infoModalRow]
                const newIndex = this.packageInfoModalController.navigateVersion(
                  currentState,
                  action.direction
                )
                if (newIndex >= 0) {
                  // Reset scroll to top when switching versions
                  stateManager.resetInfoModalScroll()
                  // Load the version if not already loaded
                  if (!this.packageInfoModalController.isVersionLoaded(currentState, newIndex)) {
                    this.packageInfoModalController.loadVersionAtIndex(
                      currentState,
                      newIndex,
                      () => {
                        if (!isResolved) renderInterface()
                      }
                    )
                  }
                } else {
                  return
                }
              } else {
                return
              }
            }
            break
          case 'enter_filter_mode':
            stateManager.enterFilterMode(action.preserveQuery)
            break
          case 'exit_filter_mode':
            stateManager.exitFilterMode(action.clearQuery)
            break
          case 'filter_input':
            stateManager.appendToFilterQuery(action.char)
            // Re-calculate filtered states after input
            break
          case 'filter_backspace':
            stateManager.deleteFromFilterQuery()
            // Re-calculate filtered states after backspace
            break
          case 'resize':
            const heightChanged = stateManager.updateTerminalHeight(action.height)
            if (heightChanged) {
              stateManager.resetForResize(filteredStates.length)
            } else {
              // Even if height didn't change, width might have changed
              // Force a full re-render to clear any wrapping issues
              stateManager.setInitialRender(true)
            }
            break
          case 'toggle_theme_modal':
            stateManager.toggleThemeModal()
            break
          case 'theme_navigate_up': {
            const themeManager = stateManager.getThemeManager()
            const currentIndex = themeNames.indexOf(themeManager.getPreviewTheme())
            const themeArray = Object.keys(themes)
            const nextIndex = currentIndex > 0 ? currentIndex - 1 : themeArray.length - 1
            stateManager.previewTheme(themeArray[nextIndex])
            break
          }
          case 'theme_navigate_down': {
            const themeManager = stateManager.getThemeManager()
            const currentIndex = themeNames.indexOf(themeManager.getPreviewTheme())
            const themeArray = Object.keys(themes)
            const nextIndex = currentIndex < themeArray.length - 1 ? currentIndex + 1 : 0
            stateManager.previewTheme(themeArray[nextIndex])
            break
          }
          case 'theme_confirm':
            stateManager.confirmTheme()
            break
          case 'trigger_audit_scan':
            if (!uiState.showThemeModal) {
              const auditProgress = this.vulnerabilityAuditController.getProgress()
              if (auditProgress.hasData) {
                stateManager.toggleVulnerableFilter()
              } else if (!auditProgress.isRunning) {
                this.enqueueSecurityAudit(states)
              }
            }
            break
          case 'cancel':
            this.packageInfoModalController.cancel()
            handleCancel()
            return
        }
        if (action.type !== 'toggle_info_modal') {
          renderInterface()
        }
      }

      const handleConfirm = (selectedStates: PackageSelectionState[]) => {
        finalizeSelection(selectedStates)
      }

      const handleCancel = () => {
        finalizeSelection(states.map((s) => ({ ...s, selectedOption: 'none' })))
      }

      const inputHandler = new InputHandler(stateManager, handleAction, handleConfirm, handleCancel)
      const resetAnsiPattern = /\x1b\[(?:0|49)m/g
      const packageListRenderOptions: PackageListRenderOptions = {
        showPeerDependencyVulnerabilities: this.options.showPeerDependencyVulnerabilities,
        showOptionalDependencyVulnerabilities: this.options.showOptionalDependencyVulnerabilities,
      }
      const keypressHandler = (str: string, key: Key) =>
        inputHandler.handleKeypress(str, key, states)

      const buildRemainingViewport = (
        terminalWidth: number,
        terminalHeight: number,
        usedLines: number
      ): string[] => {
        const remainingLines = Math.max(0, terminalHeight - usedLines)
        const blankLine = ' '.repeat(terminalWidth)
        return Array.from({ length: remainingLines }, () => blankLine)
      }

      const applyBackgroundToLine = (line: string, bgCode: string): string =>
        `${bgCode}${line.replace(resetAnsiPattern, (match) => `${match}${bgCode}`)}${getTerminalResetCode()}`

      const writeFrame = (lines: string[], bgCode: string) => {
        if (lines.length === 0) {
          return
        }

        process.stdout.write(lines.map((line) => applyBackgroundToLine(line, bgCode)).join('\n'))
      }

      const key = (text: string) => chalk.bold.white(text)
      const hint = (text: string) => chalk.gray(text)
      const sep = hint('  ·  ')

      const SHORTCUTS = {
        scroll: key('↑/↓ ') + hint('Scroll'),
        version: key('←/→ ') + hint('Version'),
        switchTab: key('Tab ') + hint('Switch tab'),
        closeInfo: key('I / Esc ') + hint('Close'),
        closeTheme: key('T / Esc ') + hint('Close'),
      }

      const buildModalHeaderLines = (shortcutLabel: string): string[] => [
        '  ' + chalk.bold('🚀 ') + coloredInupLogo(),
        '',
        '  ' + shortcutLabel,
        '',
      ]

      const renderViewport = (
        lines: string[],
        terminalWidth: number,
        terminalHeight: number,
        bgCode: string
      ) => {
        const viewportLines = [
          ...lines,
          ...buildRemainingViewport(terminalWidth, terminalHeight, lines.length),
        ]
        writeFrame(viewportLines, bgCode)
      }

      const renderModalViewport = (
        mode: 'info-modal' | 'theme-modal',
        shortcutLabel: string,
        modalLines: string[],
        terminalWidth: number,
        terminalHeight: number,
        bgCode: string
      ) => {
        const viewportLineCount = buildModalHeaderLines(shortcutLabel).length + modalLines.length
        const shouldClearBeforeRender =
          previousViewportMode !== mode || previousModalViewportLineCount !== viewportLineCount

        if (shouldClearBeforeRender) {
          CursorUtils.clearScreen()
          CursorUtils.hide()
        }

        renderViewport(
          [...buildModalHeaderLines(shortcutLabel), ...modalLines],
          terminalWidth,
          terminalHeight,
          bgCode
        )
        previousViewportMode = mode
        previousModalViewportLineCount = viewportLineCount
        stateManager.markRendered([])
      }

      let cleanupInteractiveSession = () => {
        process.stdout.write(getTerminalResetCode())
        CursorUtils.show()
        process.stdin.off('keypress', keypressHandler)
        process.stdin.pause()
        process.off('SIGWINCH', handleResize)
        this.refreshView = undefined
      }

      // Safety net: restore terminal if the process exits without going through finalizeSelection.
      // Only synchronous writes work in an 'exit' handler, but that's all we need here.
      const emergencyCleanup = () => {
        if (ownsAlternateScreen) {
          process.stdout.write('\x1b[?1049l')
        }
        process.stdout.write('\x1b[?25h')
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(false)
        }
      }
      process.on('exit', emergencyCleanup)

      const finalizeSelection = (selectedStates: PackageSelectionState[]) => {
        isResolved = true
        this.packageInfoModalController.cancel()
        releaseInteractiveScreen()
        cleanupInteractiveSession()
        process.off('exit', emergencyCleanup)
        resolve(selectedStates)
      }

      const renderInterface = () => {
        const uiState = stateManager.getUIState()
        const filteredStates = stateManager.getFilteredStates(states, vulnerabilityDisplayOptions)
        const auditProgress = this.vulnerabilityAuditController.getProgress()

        // Apply terminal background color
        const bgCode = getTerminalBgColorCode()
        process.stdout.write(bgCode)

        if (uiState.forceFullRender) {
          CursorUtils.clearScreen()
          CursorUtils.hide()
        } else {
          CursorUtils.moveToHome()
        }

        // If theme modal is open, render only the theme selector
        if (uiState.showThemeModal) {
          const terminalWidth = process.stdout.columns || 80
          const terminalHeight = this.getTerminalHeight()
          const themeManager = stateManager.getThemeManager()

          const modalLines = this.renderer.renderThemeSelectorModal(
            themeManager.getCurrentTheme(),
            themeManager.getPreviewTheme(),
            terminalWidth,
            terminalHeight
          )

          renderModalViewport(
            'theme-modal',
            SHORTCUTS.closeTheme,
            modalLines,
            terminalWidth,
            terminalHeight,
            bgCode
          )
        } else if (uiState.showDebugModal) {
          const terminalWidth = process.stdout.columns || 80
          const terminalHeight = this.getTerminalHeight()
          const snapshot = getPerformanceTracker().snapshot()
          const result = renderPerformanceModal(
            snapshot,
            terminalWidth,
            Math.max(8, terminalHeight - 4),
            uiState.debugModalScrollOffset
          )
          debugModalMaxScrollOffset = result.maxScrollOffset
          stateManager.clampDebugModalScrollOffset(debugModalMaxScrollOffset)
          const debugHints = [
            result.usesInternalScroll && result.maxScrollOffset > 0 ? SHORTCUTS.scroll : '',
            SHORTCUTS.closeInfo,
          ].filter(Boolean).join(sep)
          renderModalViewport(
            'info-modal',
            debugHints,
            result.lines,
            terminalWidth,
            terminalHeight,
            bgCode
          )
        } else if (
          uiState.showInfoModal &&
          uiState.infoModalRow >= 0 &&
          uiState.infoModalRow < filteredStates.length
        ) {
          const selectedState = filteredStates[uiState.infoModalRow]
          const terminalWidth = process.stdout.columns || 80
          const terminalHeight = this.getTerminalHeight()

          if (uiState.isLoadingModalInfo) {
            // Show loading state
            const result = this.renderer.renderPackageInfoLoading(
              selectedState,
              terminalWidth,
              Math.max(8, terminalHeight - 4)
            )
            infoModalMaxScrollOffset = result.maxScrollOffset
            renderModalViewport(
              'info-modal',
              SHORTCUTS.closeInfo,
              result.lines,
              terminalWidth,
              terminalHeight,
              bgCode
            )
          } else {
            // Show full info with scroll support
            const activeTab = uiState.infoModalTab
            const result = this.renderer.renderPackageInfoModal(
              selectedState,
              terminalWidth,
              Math.max(8, terminalHeight - 4),
              uiState.infoModalScrollOffset,
              activeTab
            )
            infoModalMaxScrollOffset = result.maxScrollOffset
            stateManager.clampInfoModalScrollOffset(infoModalMaxScrollOffset)
            const hints = [
              result.usesInternalScroll && result.maxScrollOffset > 0 ? SHORTCUTS.scroll : '',
              activeTab === 'info' ? SHORTCUTS.version : '',
              SHORTCUTS.switchTab,
              SHORTCUTS.closeInfo,
            ].filter(Boolean).join(sep)
            renderModalViewport(
              'info-modal',
              hints,
              result.lines,
              terminalWidth,
              terminalHeight,
              bgCode
            )
          }
        } else {
          // Normal list view (flat rendering - no grouping)
          const terminalWidth = process.stdout.columns || 80
          const terminalHeight = this.getTerminalHeight()
          const activeFilterLabel = stateManager.getActiveFilterLabel()
          const lines = this.renderer.renderInterface(
            filteredStates,
            uiState.currentRow,
            uiState.scrollOffset,
            uiState.maxVisibleItems,
            uiState.forceFullRender,
            [], // No renderable items - use flat rendering
            activeFilterLabel, // Show current dependency type filter state
            this.packageManager, // Pass package manager info for header
            uiState.filterMode,
            uiState.filterQuery,
            states.length,
            terminalWidth,
            loadingProgress,
            auditProgress,
            packageListRenderOptions
          )

          renderViewport(lines, terminalWidth, terminalHeight, bgCode)
          previousViewportMode = 'list'
          previousModalViewportLineCount = null
          stateManager.markRendered(lines)
        }

        stateManager.setInitialRender(false)
      }

      const handleResize = () => {
        // On resize (width or height change), always trigger a re-render
        // This prevents layout breaking when terminal width changes
        // The action handler will update height and force a full re-render
        inputHandler.handleResize(this.getTerminalHeight())
      }

      // Setup keypress handling
      try {
        claimInteractiveScreen()

        this.refreshView = () => {
          if (!isResolved) {
            renderInterface()
          }
        }

        attachRefresh?.(() => {
          if (!isResolved) {
            renderInterface()
          }
        })

        const keypressSession = TerminalInput.startKeypressSession(keypressHandler)
        const previousCleanup = cleanupInteractiveSession
        cleanupInteractiveSession = () => {
          keypressSession.close()
          previousCleanup()
        }

        // Setup resize handler
        process.on('SIGWINCH', handleResize)

        // Update terminal height directly before initial render to ensure correct dimensions
        // This handles cases where process.stdout.rows might not be accurate at startup
        const currentHeight = this.getTerminalHeight()
        if (stateManager.updateTerminalHeight(currentHeight)) {
          const initialFiltered = stateManager.getFilteredStates(
            states,
            vulnerabilityDisplayOptions
          )
          stateManager.resetForResize(initialFiltered.length)
        }

        // Initial render
        renderInterface()
        this.enqueueSecurityAudit(states)
      } catch (error) {
        process.off('exit', emergencyCleanup)
        releaseInteractiveScreen()
        // Reset terminal colors
        process.stdout.write(getTerminalResetCode())
        this.refreshView = undefined
        // Fallback to simple interface if raw mode fails
        console.log(chalk.yellow('Raw mode not available, using fallback interface...'))
        resolve(states)
      }
    })
  }

  public async confirmUpgrade(choices: PackageUpgradeChoice[]): Promise<boolean | null> {
    console.log(this.renderer.renderConfirmation(choices))

    return new Promise((resolve) => {
      let cleanupConfirmationSession = () => {
        CursorUtils.show()
      }

      const handleConfirm = (confirmed: boolean | null) => {
        cleanupConfirmationSession()
        resolve(confirmed)
      }

      // Safety net for the same reason as selectPackages — synchronous restore on exit.
      // The confirmation screen does not enter the alternate screen, so alt-screen
      // restoration is intentionally omitted here. If that ever changes, mirror the
      // ownsAlternateScreen-gated pattern from selectPackages.
      const confirmEmergencyCleanup = () => {
        process.stdout.write('\x1b[?25h')
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(false)
        }
      }
      process.on('exit', confirmEmergencyCleanup)

      const handleConfirmWithCleanup = (confirmed: boolean | null) => {
        handleConfirm(confirmed)
        process.off('exit', confirmEmergencyCleanup)
      }

      const inputHandler = new ConfirmationInputHandler(handleConfirmWithCleanup)
      const keypressHandler = (str: string, key: Key) => inputHandler.handleKeypress(str, key)

      // Setup keypress handling
      try {
        const keypressSession = TerminalInput.startKeypressSession(keypressHandler)
        cleanupConfirmationSession = () => {
          keypressSession.close()
          CursorUtils.show()
        }
        CursorUtils.hide()
      } catch (error) {
        process.off('exit', confirmEmergencyCleanup)
        TerminalInput.promptForConfirmation('Proceed with upgrade? [Y/n] ')
          .then(resolve)
          .catch(() => resolve(false))
      }
    })
  }
}
