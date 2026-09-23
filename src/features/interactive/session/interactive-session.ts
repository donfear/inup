import type { Key } from 'node:readline'
import chalk from 'chalk'
import { configManager } from '../../../shared/config/user-config'
import { ConsoleUtils, CursorUtils, TerminalInput } from '../../../shared/terminal'
import { RAW_EXIT_ALT_SCREEN, RAW_SHOW_CURSOR } from '../../../shared/terminal/cursor'
import type {
  CooldownRenderStatus,
  PackageLoadProgress,
  PackageManagerInfo,
  PackageSelectionState,
  VulnerabilityDisplayOptions,
} from '../../../shared/types'
import type { VulnerabilityAuditController } from '../../audit'
import { getPerformanceTracker } from '../../debug'
import type { PackageInfoModalController } from '../controllers'
import { InputHandler } from '../input-handler'
import type { UIRenderer } from '../renderer'
import { renderHelpModal } from '../renderer/help-modal'
import { type PackageListRenderOptions, VersionColumnLayout } from '../renderer/package-list'
import { renderPerformanceModal } from '../renderer/performance-modal'
import { StateManager } from '../state'
import { getTerminalBgColorCode, getTerminalResetCode, inupLogo } from '../themes-colors'
import { dispatchAction } from './action-dispatcher'
import type { SelectionList } from './selection-list'

function getTerminalHeight(): number {
  if (process.stdout.isTTY && typeof process.stdout.rows === 'number' && process.stdout.rows > 0) {
    return process.stdout.rows
  }
  return 24
}

/**
 * Display options for a session: the vulnerability toggles, plus the count of packages the
 * release-age cooldown withheld a version from that are absent from the list (the list holds
 * only outdated packages, so those would otherwise leave no trace at all).
 */
export type SessionDisplayOptions = Required<VulnerabilityDisplayOptions> & {
  /** Held by reference so the header tracks the scan instead of freezing at mount time. */
  cooldown?: CooldownRenderStatus
}

export interface InteractiveSessionHandle {
  refresh: () => void
  abort: (error: unknown) => void
}

export async function runInteractiveSession(
  selection: SelectionList,
  packageManager: PackageManagerInfo,
  renderer: UIRenderer,
  packageInfoModalController: PackageInfoModalController,
  vulnerabilityAuditController: VulnerabilityAuditController,
  options: SessionDisplayOptions,
  onSessionReady?: (session: InteractiveSessionHandle | undefined) => void,
  loadingProgress?: PackageLoadProgress
): Promise<PackageSelectionState[]> {
  return new Promise((resolve, reject) => {
    const states = selection.items
    const stateManager = new StateManager(
      0,
      getTerminalHeight(),
      configManager.getFilters() ?? undefined
    )
    let isResolved = false
    let ownsAlternateScreen = false
    let inputReady = false
    let backgroundRender: ReturnType<typeof setTimeout> | undefined
    const columnLayout = new VersionColumnLayout()
    // The package under the cursor, tracked by identity so rows inserted above
    // it while loading move the index, not the focus. Until the user touches
    // the keyboard the cursor stays pinned to the top of the list.
    let focusedState: PackageSelectionState | undefined
    let userInteracted = false
    let reconciledRevision = selection.revision
    // The last frame written, line by line, so the next one writes only what changed.
    let lastFrame: string[] | null = null
    const cancelBackgroundRender = () => {
      if (backgroundRender !== undefined) {
        clearTimeout(backgroundRender)
        backgroundRender = undefined
      }
    }
    const vulnerabilityDisplayOptions: VulnerabilityDisplayOptions = options

    let infoModalMaxScrollOffset = 0
    let debugModalMaxScrollOffset = 0
    let helpModalMaxScrollOffset = 0
    let previousViewportMode: 'list' | 'info-modal' | 'theme-modal' | null = null
    let previousModalViewportLineCount: number | null = null

    const claimInteractiveScreen = () => {
      // Claimed exactly once per session; the guard is a safety net in case a
      // future caller re-claims.
      /* v8 ignore start */
      if (ownsAlternateScreen) return
      /* v8 ignore stop */
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

    // biome-ignore lint/suspicious/noControlCharactersInRegex: matches ANSI escape sequences by design
    const resetAnsiPattern = /\x1b\[(?:0|49)m/g
    const packageListRenderOptions: PackageListRenderOptions = {
      showPeerDependencyVulnerabilities: options.showPeerDependencyVulnerabilities,
      showOptionalDependencyVulnerabilities: options.showOptionalDependencyVulnerabilities,
      cooldown: options.cooldown,
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
      closeDebug: key('! / Esc ') + hint('Close'),
    }

    const buildModalHeaderLines = (shortcutLabel: string): string[] => [
      `  ${inupLogo()}`,
      '',
      `  ${shortcutLabel}`,
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

    const writeFrame = (lines: string[], bgCode: string, full: boolean) => {
      // Viewports are always padded to the terminal height, so an empty frame
      // cannot occur today; guard kept so a future caller cannot emit garbage.
      /* v8 ignore start */
      if (lines.length === 0) return
      /* v8 ignore stop */
      const painted = lines.map((line) => applyBackgroundToLine(line, bgCode))
      if (full || lastFrame === null || lastFrame.length !== painted.length) {
        process.stdout.write(painted.join('\n'))
      } else {
        // Same viewport shape as the last frame: address only the lines that
        // changed. Each is cleared to the end so a shorter line leaves nothing.
        let output = ''
        for (let row = 0; row < painted.length; row++) {
          if (painted[row] !== lastFrame[row]) output += `\x1b[${row + 1};1H${painted[row]}\x1b[K`
        }
        if (output) process.stdout.write(output)
      }
      lastFrame = painted
    }

    const renderViewport = (
      lines: string[],
      terminalWidth: number,
      terminalHeight: number,
      bgCode: string,
      full: boolean
    ) => {
      const viewportLines = [
        ...lines,
        ...buildRemainingViewport(terminalWidth, terminalHeight, lines.length),
      ]
      writeFrame(viewportLines, bgCode, full)
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
        bgCode,
        shouldClearBeforeRender
      )
      previousViewportMode = mode
      previousModalViewportLineCount = viewportLineCount
    }

    // Rows inserted since the last frame may sit above the focused package:
    // move the cursor with it before anything reads an index.
    const syncCursorToList = () => {
      if (selection.revision === reconciledRevision) return
      reconciledRevision = selection.revision
      if (!userInteracted || !focusedState) return
      // focusedState came from the last rendered filtered list and inserts are
      // the only change since, so it is still present; shiftRows clamps anyway.
      const filteredStates = stateManager.getFilteredStates(states, vulnerabilityDisplayOptions)
      const index = filteredStates.indexOf(focusedState)
      stateManager.shiftRows(index - stateManager.getUIState().currentRow, filteredStates.length)
    }

    const renderInterface = () => {
      cancelBackgroundRender()
      syncCursorToList()
      const uiState = stateManager.getUIState()
      const filteredStates = stateManager.getFilteredStates(states, vulnerabilityDisplayOptions)
      const auditProgress = vulnerabilityAuditController.getProgress()

      const bgCode = getTerminalBgColorCode()
      process.stdout.write(bgCode)

      if (uiState.forceFullRender) {
        CursorUtils.clearScreen()
        CursorUtils.hide()
        lastFrame = null
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
          SHORTCUTS.closeDebug,
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
          activeFilterLabel,
          packageManager,
          uiState.filterMode,
          uiState.filterQuery,
          states.length,
          terminalWidth,
          loadingProgress,
          auditProgress,
          {
            ...packageListRenderOptions,
            cooldownHeldShown: stateManager.isCooldownHeldFilterActive(),
            columnWidths: columnLayout.get(selection.arrivals, terminalWidth),
            selectedCount: states.filter((state) => state.selectedOption !== 'none').length,
          },
          uiState.notice
        )

        renderViewport(
          lines,
          terminalWidth,
          terminalHeight,
          bgCode,
          uiState.forceFullRender || previousViewportMode !== 'list'
        )
        previousViewportMode = 'list'
        previousModalViewportLineCount = null
        focusedState = filteredStates[uiState.currentRow]
      }

      stateManager.setInitialRender(false)
    }

    // Background work (package arrivals, audit results, modal loads) renders at
    // most once per window and never delays keyboard input: renderInterface
    // consumes any pending frame. A renderer failure here has no caller to
    // propagate to, so it ends the session the way the synchronous path would.
    const requestBackgroundRender = () => {
      if (isResolved || backgroundRender !== undefined) return
      backgroundRender = setTimeout(() => {
        backgroundRender = undefined
        try {
          renderInterface()
        } catch (error) {
          teardown()
          reject(error)
        }
      }, 16)
    }

    // Safety net: restore terminal if the process exits without going through finalizeSelection.
    // Only synchronous writes work in an 'exit' handler, but that's all we need here.
    // Coverage: the body only runs during a real process 'exit' event, which
    // cannot be fired safely inside the test process.
    /* v8 ignore start */
    const emergencyCleanup = () => {
      if (ownsAlternateScreen) {
        process.stdout.write(RAW_EXIT_ALT_SCREEN)
      }
      process.stdout.write(RAW_SHOW_CURSOR)
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(false)
      }
    }
    /* v8 ignore stop */
    process.on('exit', emergencyCleanup)

    let cleanupInteractiveSession = () => {
      process.stdout.write(getTerminalResetCode())
      CursorUtils.show()
      process.stdin.off('keypress', keypressHandler)
      process.stdin.pause()
      process.off('SIGWINCH', handleResize)
    }

    const teardown = () => {
      isResolved = true
      cancelBackgroundRender()
      onSessionReady?.(undefined)
      packageInfoModalController.cancel()
      releaseInteractiveScreen()
      cleanupInteractiveSession()
      process.off('exit', emergencyCleanup)
    }

    const finalizeSelection = (selectedStates: PackageSelectionState[]) => {
      // Remember the view filters for next launch (best-effort, never throws).
      configManager.setFilters(stateManager.getFilterSnapshot())
      teardown()
      resolve(selectedStates)
    }

    const handleConfirm = (confirmed: PackageSelectionState[]) => {
      finalizeSelection(confirmed)
    }

    const handleCancel = () => {
      finalizeSelection(states.map((s) => ({ ...s, selectedOption: 'none' })))
    }

    // Every keyboard action renders from here, once, if it changed the view;
    // async continuations inside the dispatcher go through requestRender.
    const inputHandler = new InputHandler(
      stateManager,
      (action) => {
        syncCursorToList()
        const changed = dispatchAction(action, {
          stateManager,
          states,
          vulnerabilityDisplayOptions,
          packageInfoModalController,
          vulnerabilityAuditController,
          isResolved: () => isResolved,
          requestRender: requestBackgroundRender,
          handleCancel,
          getInfoModalMaxScrollOffset: () => infoModalMaxScrollOffset,
          getDebugModalMaxScrollOffset: () => debugModalMaxScrollOffset,
          getHelpModalMaxScrollOffset: () => helpModalMaxScrollOffset,
        })
        if (changed) renderInterface()
      },
      handleConfirm,
      handleCancel
    )

    // A renderer failure on the keyboard path has no caller to propagate to
    // either; end the session the same way the background path does.
    const keypressHandler = (str: string, key: Key) => {
      userInteracted = true
      try {
        inputHandler.handleKeypress(str, key, states)
      } catch (error) {
        teardown()
        reject(error)
      }
    }

    const handleResize = () => {
      inputHandler.handleResize(getTerminalHeight())
    }

    try {
      claimInteractiveScreen()

      // The one hook every background producer (package arrivals, audit
      // results) refreshes through; revoked again by teardown.
      onSessionReady?.({
        refresh: requestBackgroundRender,
        abort: (error) => {
          if (isResolved) return
          teardown()
          reject(error)
        },
      })

      const keypressSession = TerminalInput.startKeypressSession(keypressHandler)
      inputReady = true
      const previousCleanup = cleanupInteractiveSession
      cleanupInteractiveSession = () => {
        keypressSession.close()
        previousCleanup()
      }

      process.on('SIGWINCH', handleResize)

      // The state manager was constructed with getTerminalHeight() in this same
      // tick, so the height cannot have changed yet; kept as a safety net for a
      // future async gap between construction and startup.
      /* v8 ignore start */
      const currentHeight = getTerminalHeight()
      if (stateManager.updateTerminalHeight(currentHeight)) {
        const initialFiltered = stateManager.getFilteredStates(states, vulnerabilityDisplayOptions)
        stateManager.resetForResize(initialFiltered.length)
      }
      /* v8 ignore stop */

      renderInterface()
      vulnerabilityAuditController.enqueueStates(states, requestBackgroundRender)
    } catch (error) {
      teardown()
      if (inputReady) {
        reject(error)
        return
      }
      console.log(chalk.yellow('Raw mode not available, using fallback interface...'))
      resolve(states)
    }
  })
}
