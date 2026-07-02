import chalk from 'chalk'
import { Key } from 'node:readline'
import {
  PackageSelectionState,
  PackageManagerInfo,
  PackageLoadProgress,
  VulnerabilityDisplayOptions,
} from '../../shared/types'
import {
  StateManager,
  UIRenderer,
  InputHandler,
  CursorUtils,
  ConsoleUtils,
  TerminalInput,
} from '../index'
import { RAW_EXIT_ALT_SCREEN, RAW_SHOW_CURSOR } from '../../shared/terminal/cursor'
import { PackageListRenderOptions } from '../renderer/package-list'
import { getTerminalBgColorCode, getTerminalResetCode, coloredInupLogo } from '../themes-colors'
import { getPerformanceTracker, renderPerformanceModal } from '../../features/debug'
import { PackageInfoModalController, VulnerabilityAuditController } from '../controllers'
import { renderHelpModal } from '../renderer/help-modal'
import { configManager } from '../../shared/config/user-config'
import { dispatchAction } from './action-dispatcher'

function getTerminalHeight(): number {
  if (process.stdout.isTTY && typeof process.stdout.rows === 'number' && process.stdout.rows > 0) {
    return process.stdout.rows
  }
  return 24
}

export async function runInteractiveSession(
  selectionStates: PackageSelectionState[],
  packageManager: PackageManagerInfo,
  renderer: UIRenderer,
  packageInfoModalController: PackageInfoModalController,
  vulnerabilityAuditController: VulnerabilityAuditController,
  options: Required<VulnerabilityDisplayOptions>,
  onRefreshViewReady?: (refresh: (() => void) | undefined) => void,
  loadingProgress?: PackageLoadProgress,
  attachRefresh?: (refresh: () => void) => void
): Promise<PackageSelectionState[]> {
  return new Promise((resolve) => {
    const states = selectionStates
    const stateManager = new StateManager(
      0,
      getTerminalHeight(),
      configManager.getFilters() ?? undefined
    )
    let isResolved = false
    let ownsAlternateScreen = false
    const vulnerabilityDisplayOptions: VulnerabilityDisplayOptions = options

    let infoModalMaxScrollOffset = 0
    let debugModalMaxScrollOffset = 0
    let helpModalMaxScrollOffset = 0
    let previousViewportMode: 'list' | 'info-modal' | 'theme-modal' | null = null
    let previousModalViewportLineCount: number | null = null

    stateManager.setRenderableItems([])

    const claimInteractiveScreen = () => {
      if (ownsAlternateScreen) return
      ConsoleUtils.clearProgress()
      CursorUtils.enterAlternateScreen()
      CursorUtils.clearScreen()
      ownsAlternateScreen = true
    }

    const releaseInteractiveScreen = () => {
      if (!ownsAlternateScreen) return
      CursorUtils.exitAlternateScreen()
      ownsAlternateScreen = false
    }

    const resetAnsiPattern = /\x1b\[(?:0|49)m/g
    const packageListRenderOptions: PackageListRenderOptions = {
      showPeerDependencyVulnerabilities: options.showPeerDependencyVulnerabilities,
      showOptionalDependencyVulnerabilities: options.showOptionalDependencyVulnerabilities,
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
      closeHelp: key('? / Esc ') + hint('Close'),
    }

    const buildModalHeaderLines = (shortcutLabel: string): string[] => [
      '  ' + chalk.bold('🚀 ') + coloredInupLogo(),
      '',
      '  ' + shortcutLabel,
      '',
    ]

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
      if (lines.length === 0) return
      process.stdout.write(lines.map((line) => applyBackgroundToLine(line, bgCode)).join('\n'))
    }

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

    const renderInterface = () => {
      const uiState = stateManager.getUIState()
      const filteredStates = stateManager.getFilteredStates(states, vulnerabilityDisplayOptions)
      const auditProgress = vulnerabilityAuditController.getProgress()

      const bgCode = getTerminalBgColorCode()
      process.stdout.write(bgCode)

      if (uiState.forceFullRender) {
        CursorUtils.clearScreen()
        CursorUtils.hide()
      } else {
        CursorUtils.moveToHome()
      }

      if (uiState.showThemeModal) {
        const terminalWidth = process.stdout.columns || 80
        const terminalHeight = getTerminalHeight()
        const themeManager = stateManager.getThemeManager()

        const modalLines = renderer.renderThemeSelectorModal(
          themeManager.getCurrentTheme(),
          themeManager.getPreviewTheme(),
          terminalWidth,
          Math.max(8, terminalHeight - 8)
        )

        renderModalViewport(
          'theme-modal',
          SHORTCUTS.closeTheme,
          modalLines,
          terminalWidth,
          terminalHeight,
          bgCode
        )
      } else if (uiState.showHelpModal) {
        const terminalWidth = process.stdout.columns || 80
        const terminalHeight = getTerminalHeight()
        const result = renderHelpModal(
          terminalWidth,
          Math.max(8, terminalHeight - 4),
          uiState.helpModalScrollOffset
        )
        helpModalMaxScrollOffset = result.maxScrollOffset
        stateManager.clampHelpModalScrollOffset(helpModalMaxScrollOffset)
        const helpHints = [
          result.usesInternalScroll && result.maxScrollOffset > 0 ? SHORTCUTS.scroll : '',
          SHORTCUTS.closeHelp,
        ]
          .filter(Boolean)
          .join(sep)
        renderModalViewport(
          'info-modal',
          helpHints,
          result.lines,
          terminalWidth,
          terminalHeight,
          bgCode
        )
      } else if (uiState.showDebugModal) {
        const terminalWidth = process.stdout.columns || 80
        const terminalHeight = getTerminalHeight()
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
        ]
          .filter(Boolean)
          .join(sep)
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
        const terminalHeight = getTerminalHeight()

        if (uiState.isLoadingModalInfo) {
          const result = renderer.renderPackageInfoLoading(
            selectedState,
            terminalWidth,
            Math.max(8, terminalHeight - 8)
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
          const activeTab = uiState.infoModalTab
          const result = renderer.renderPackageInfoModal(
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
          ]
            .filter(Boolean)
            .join(sep)
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
        const terminalWidth = process.stdout.columns || 80
        const terminalHeight = getTerminalHeight()
        const activeFilterLabel = stateManager.getActiveFilterLabel()
        const lines = renderer.renderInterface(
          filteredStates,
          uiState.currentRow,
          uiState.scrollOffset,
          uiState.maxVisibleItems,
          uiState.forceFullRender,
          [],
          activeFilterLabel,
          packageManager,
          uiState.filterMode,
          uiState.filterQuery,
          states.length,
          terminalWidth,
          loadingProgress,
          auditProgress,
          packageListRenderOptions,
          uiState.notice
        )

        renderViewport(lines, terminalWidth, terminalHeight, bgCode)
        previousViewportMode = 'list'
        previousModalViewportLineCount = null
        stateManager.markRendered(lines)
      }

      stateManager.setInitialRender(false)
    }

    // Safety net: restore terminal if the process exits without going through finalizeSelection.
    // Only synchronous writes work in an 'exit' handler, but that's all we need here.
    const emergencyCleanup = () => {
      if (ownsAlternateScreen) {
        process.stdout.write(RAW_EXIT_ALT_SCREEN)
      }
      process.stdout.write(RAW_SHOW_CURSOR)
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(false)
      }
    }
    process.on('exit', emergencyCleanup)

    let cleanupInteractiveSession = () => {
      process.stdout.write(getTerminalResetCode())
      CursorUtils.show()
      process.stdin.off('keypress', keypressHandler)
      process.stdin.pause()
      process.off('SIGWINCH', handleResize)
    }

    const finalizeSelection = (selectedStates: PackageSelectionState[]) => {
      isResolved = true
      onRefreshViewReady?.(undefined)
      packageInfoModalController.cancel()
      // Remember the view filters for next launch (best-effort, never throws).
      configManager.setFilters(stateManager.getFilterSnapshot())
      releaseInteractiveScreen()
      cleanupInteractiveSession()
      process.off('exit', emergencyCleanup)
      resolve(selectedStates)
    }

    const handleConfirm = (confirmed: PackageSelectionState[]) => {
      finalizeSelection(confirmed)
    }

    const handleCancel = () => {
      finalizeSelection(states.map((s) => ({ ...s, selectedOption: 'none' })))
    }

    const inputHandler = new InputHandler(
      stateManager,
      (action) =>
        dispatchAction(action, {
          stateManager,
          states,
          vulnerabilityDisplayOptions,
          packageInfoModalController,
          vulnerabilityAuditController,
          isResolved: () => isResolved,
          renderInterface,
          handleCancel,
          getInfoModalMaxScrollOffset: () => infoModalMaxScrollOffset,
          getDebugModalMaxScrollOffset: () => debugModalMaxScrollOffset,
          getHelpModalMaxScrollOffset: () => helpModalMaxScrollOffset,
        }),
      handleConfirm,
      handleCancel
    )

    const keypressHandler = (str: string, key: Key) => inputHandler.handleKeypress(str, key, states)

    const handleResize = () => {
      inputHandler.handleResize(getTerminalHeight())
    }

    try {
      claimInteractiveScreen()

      onRefreshViewReady?.(() => {
        if (!isResolved) renderInterface()
      })

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

      process.on('SIGWINCH', handleResize)

      const currentHeight = getTerminalHeight()
      if (stateManager.updateTerminalHeight(currentHeight)) {
        const initialFiltered = stateManager.getFilteredStates(states, vulnerabilityDisplayOptions)
        stateManager.resetForResize(initialFiltered.length)
      }

      renderInterface()
      vulnerabilityAuditController.enqueueStates(states, () => {
        if (!isResolved) renderInterface()
      })
    } catch (error) {
      onRefreshViewReady?.(undefined)
      process.off('exit', emergencyCleanup)
      releaseInteractiveScreen()
      process.stdout.write(getTerminalResetCode())
      console.log(chalk.yellow('Raw mode not available, using fallback interface...'))
      resolve(states)
    }
  })
}
