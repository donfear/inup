import inquirer from 'inquirer'
import chalk from 'chalk'
import * as semver from 'semver'
const keypress = require('keypress')
import {
  PackageInfo,
  PackageUpgradeChoice,
  PackageSelectionState,
  PackageManagerInfo,
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
} from './ui'
import { changelogFetcher } from './services'
import { themeNames, themes } from './ui/themes'

export class InteractiveUI {
  private renderer: UIRenderer
  private packageManager: PackageManagerInfo

  constructor(packageManager: PackageManagerInfo) {
    this.renderer = new UIRenderer()
    this.packageManager = packageManager
  }

  public async displayPackagesTable(packages: PackageInfo[]): Promise<void> {
    console.log(this.renderer.renderPackagesTable(packages))
  }

  public async selectPackagesToUpgrade(
    packages: PackageInfo[],
    previousSelections?: Map<string, 'none' | 'range' | 'latest'>,
    options?: { includePeerDeps?: boolean; includeOptionalDeps?: boolean }
  ): Promise<PackageUpgradeChoice[]> {
    const outdatedPackages = packages.filter((p) => p.isOutdated)

    if (outdatedPackages.length === 0) {
      return []
    }

    // Filter packages based on CLI options.
    // IMPORTANT: This uses an opt-in approach where:
    // - Default (no flags): shows dependencies + devDependencies
    // - With -p flag: shows ONLY peerDependencies (excludes dependencies)
    // - With -o flag: shows ONLY optionalDependencies (excludes dependencies)
    // - With -p -o flags: shows peerDependencies + optionalDependencies (excludes dependencies)
    //
    // This design allows users to focus on one dependency type at a time,
    // which is useful since peer/optional deps have different upgrade semantics.
    let filteredPackages = outdatedPackages
    let dependencyTypeLabel = ''

    if (options?.includePeerDeps || options?.includeOptionalDeps) {
      // If any special-case flag is provided, filter to show ONLY those types
      // (excluding regular dependencies/devDependencies)
      filteredPackages = outdatedPackages.filter((pkg) => {
        if (options.includePeerDeps && pkg.type === 'peerDependencies') return true
        if (options.includeOptionalDeps && pkg.type === 'optionalDependencies') return true
        return false
      })

      // Build label describing which types are shown
      const types: string[] = []
      if (options.includePeerDeps) types.push('Peer Deps')
      if (options.includeOptionalDeps) types.push('Optional Deps')
      dependencyTypeLabel = types.join(' & ')
    } else {
      // Default: show only regular dependencies and devDependencies
      filteredPackages = outdatedPackages.filter(
        (pkg) => pkg.type === 'dependencies' || pkg.type === 'devDependencies'
      )
      dependencyTypeLabel = 'Deps & Dev Deps'
    }

    if (filteredPackages.length === 0) {
      return []
    }

    // Deduplicate packages by name and version specifier, but track all package.json paths
    const uniquePackages = new Map<
      string,
      {
        pkg: PackageInfo
        packageJsonPaths: Set<string>
        type: PackageInfo['type']
      }
    >()

    for (const pkg of filteredPackages) {
      const key = `${pkg.name}@${pkg.currentVersion}`
      if (!uniquePackages.has(key)) {
        uniquePackages.set(key, {
          pkg,
          packageJsonPaths: new Set([pkg.packageJsonPath]),
          type: pkg.type,
        })
      } else {
        uniquePackages.get(key)!.packageJsonPaths.add(pkg.packageJsonPath)
      }
    }

    // Convert to array and sort alphabetically by name (@scoped packages first, then unscoped)
    const deduplicatedPackages = Array.from(uniquePackages.values()).map(
      ({ pkg, packageJsonPaths, type }) => ({
        ...pkg,
        packageJsonPaths: Array.from(packageJsonPaths),
        type,
      })
    )

    deduplicatedPackages.sort((a, b) => {
      const aIsScoped = a.name.startsWith('@')
      const bIsScoped = b.name.startsWith('@')

      // If one is scoped and the other isn't, scoped comes first
      if (aIsScoped && !bIsScoped) return -1
      if (!aIsScoped && bIsScoped) return 1

      // Both scoped or both unscoped - sort alphabetically
      return a.name.localeCompare(b.name)
    })

    // Create selection states for each unique package
    const selectionStates: PackageSelectionState[] = deduplicatedPackages.map((pkg) => {
      const currentClean = semver.coerce(pkg.currentVersion)?.version || pkg.currentVersion
      const rangeClean = semver.coerce(pkg.rangeVersion)?.version || pkg.rangeVersion
      const latestClean = semver.coerce(pkg.latestVersion)?.version || pkg.latestVersion

      // Use previous selection if available, otherwise default to 'none'
      const key = `${pkg.name}@${pkg.currentVersion}`
      const previousSelection = previousSelections?.get(key) || 'none'

      return {
        name: pkg.name,
        packageJsonPath: pkg.packageJsonPaths[0], // Use first path for display
        packageJsonPaths: pkg.packageJsonPaths, // Store all paths for upgrading
        currentVersionSpecifier: pkg.currentVersion, // Keep original with prefix
        currentVersion: currentClean,
        rangeVersion: rangeClean,
        latestVersion: latestClean,
        selectedOption: previousSelection,
        hasRangeUpdate: pkg.hasRangeUpdate,
        hasMajorUpdate: pkg.hasMajorUpdate,
        type: pkg.type,
      }
    })

    // Use custom interactive table selector (simplified - no grouping)
    const selectedStates = await this.interactiveTableSelector(selectionStates, dependencyTypeLabel)

    // Convert to PackageUpgradeChoice[] - create one choice per package.json path
    const choices: PackageUpgradeChoice[] = []
    selectedStates
      .filter((state) => state.selectedOption !== 'none')
      .forEach((state) => {
        const targetVersion =
          state.selectedOption === 'range' ? state.rangeVersion : state.latestVersion
        const targetVersionWithPrefix = VersionUtils.applyVersionPrefix(
          state.currentVersionSpecifier,
          targetVersion
        )

        // Create a choice for each package.json path where this package appears
        const pathsToUpdate = state.packageJsonPaths || [state.packageJsonPath]
        pathsToUpdate.forEach((packageJsonPath) => {
          choices.push({
            name: state.name,
            packageJsonPath,
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
    if (process.stdout.isTTY && typeof process.stdout.rows === 'number' && process.stdout.rows > 0) {
      return process.stdout.rows
    }
    return 24 // Fallback default
  }

  private async interactiveTableSelector(
    selectionStates: PackageSelectionState[],
    dependencyTypeLabel: string
  ): Promise<PackageSelectionState[]> {
    return new Promise((resolve) => {
      const states = [...selectionStates]
      const stateManager = new StateManager(0, this.getTerminalHeight())

      // No grouping needed - packages are already filtered by type
      // This simplifies scrolling and avoids rendering issues
      stateManager.setRenderableItems([])

      const handleAction = (action: InputAction) => {
        const uiState = stateManager.getUIState()
        const filteredStates = stateManager.getFilteredStates(states)

        switch (action.type) {
          case 'navigate_up':
            if (!uiState.showInfoModal && !uiState.showThemeModal) {
              stateManager.navigateUp(filteredStates.length)
            }
            break
          case 'navigate_down':
            if (!uiState.showInfoModal && !uiState.showThemeModal) {
              stateManager.navigateDown(filteredStates.length)
            }
            break
          case 'select_left':
            if (!uiState.showInfoModal && !uiState.showThemeModal) {
              stateManager.updateSelection(filteredStates, 'left')
            }
            break
          case 'select_right':
            if (!uiState.showInfoModal && !uiState.showThemeModal) {
              stateManager.updateSelection(filteredStates, 'right')
            }
            break
          case 'bulk_select_minor':
            if (!uiState.showInfoModal && !uiState.showThemeModal) {
              stateManager.bulkSelectMinor(filteredStates)
            }
            break
          case 'bulk_select_latest':
            if (!uiState.showInfoModal && !uiState.showThemeModal) {
              stateManager.bulkSelectLatest(filteredStates)
            }
            break
          case 'bulk_unselect_all':
            if (!uiState.showInfoModal && !uiState.showThemeModal) {
              stateManager.bulkUnselectAll(filteredStates)
            }
            break
          case 'toggle_info_modal':
            if (!uiState.showInfoModal) {
              // Opening modal - load package info asynchronously
              stateManager.toggleInfoModal()
              const currentState = filteredStates[uiState.currentRow]
              stateManager.setModalLoading(true)
              renderInterface()

              // Fetch metadata asynchronously
              changelogFetcher.fetchPackageMetadata(currentState.name).then((metadata) => {
                if (metadata) {
                  currentState.description = metadata.description
                  currentState.homepage = metadata.homepage
                  currentState.repository = metadata.releaseNotes
                  currentState.weeklyDownloads = metadata.weeklyDownloads
                  currentState.author = metadata.author as string | undefined
                  currentState.license = metadata.license
                }
                stateManager.setModalLoading(false)
                renderInterface()
              })
            } else {
              // Closing modal
              stateManager.toggleInfoModal()
              renderInterface()
            }
            break
          case 'enter_filter_mode':
            stateManager.enterFilterMode()
            break
          case 'exit_filter_mode':
            stateManager.exitFilterMode()
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
              stateManager.resetForResize()
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
            if (currentIndex > 0) {
              const themeNames = Object.keys(themes)
              stateManager.previewTheme(themeNames[currentIndex - 1])
            }
            break
          }
          case 'theme_navigate_down': {
            const themeManager = stateManager.getThemeManager()
            const currentIndex = themeNames.indexOf(themeManager.getPreviewTheme())
            if (currentIndex < themeNames.length - 1) {
              const themeNames = Object.keys(themes)
              stateManager.previewTheme(themeNames[currentIndex + 1])
            }
            break
          }
          case 'theme_confirm':
            stateManager.confirmTheme()
            break
          case 'cancel':
            handleCancel()
            return
        }
        if (action.type !== 'toggle_info_modal') {
          renderInterface()
        }
      }

      const handleConfirm = (selectedStates: PackageSelectionState[]) => {
        CursorUtils.show()
        // Clean up listeners
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(false)
        }
        process.stdin.removeAllListeners('keypress')
        process.stdin.pause()
        process.removeAllListeners('SIGWINCH')
        resolve(selectedStates)
      }

      const handleCancel = () => {
        CursorUtils.show()
        // Clean up listeners
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(false)
        }
        process.stdin.removeAllListeners('keypress')
        process.stdin.pause()
        process.removeAllListeners('SIGWINCH')
        resolve(states.map((s) => ({ ...s, selectedOption: 'none' })))
      }

      const inputHandler = new InputHandler(stateManager, handleAction, handleConfirm, handleCancel)

      const renderInterface = () => {
        const uiState = stateManager.getUIState()
        const filteredStates = stateManager.getFilteredStates(states)

        if (uiState.forceFullRender) {
          console.clear()
          CursorUtils.hide()
        } else {
          CursorUtils.moveToHome()
        }

        // If theme modal is open, render only the theme selector
        if (uiState.showThemeModal) {
          const terminalWidth = process.stdout.columns || 80
          const terminalHeight = this.getTerminalHeight()
          const themeManager = stateManager.getThemeManager()

          // Render header
          const headerLines: string[] = []
          headerLines.push('  ' + chalk.bold.magenta('🚀 inup'))
          headerLines.push('')
          headerLines.push(
            '  ' +
              chalk.bold.white('T ') +
              chalk.gray('/ Esc Exit theme selector')
          )
          headerLines.push('')
          headerLines.forEach((line) => console.log(line))

          const modalLines = this.renderer.renderThemeSelectorModal(
            themeManager.getCurrentTheme(),
            themeManager.getPreviewTheme(),
            terminalWidth,
            terminalHeight
          )
          modalLines.forEach((line) => console.log(line))

          // Clear any remaining lines from previous render
          CursorUtils.clearToEndOfScreen()
          stateManager.markRendered([])
        } else if (uiState.showInfoModal && uiState.infoModalRow >= 0 && uiState.infoModalRow < filteredStates.length) {
          const selectedState = filteredStates[uiState.infoModalRow]
          const terminalWidth = process.stdout.columns || 80
          const terminalHeight = this.getTerminalHeight()

          // Render header
          const headerLines: string[] = []
          headerLines.push('  ' + chalk.bold.magenta('🚀 inup'))
          headerLines.push('')
          headerLines.push(
            '  ' +
              chalk.bold.white('I / Esc ') +
              chalk.gray('Exit this view')
          )
          headerLines.push('')
          headerLines.forEach((line) => console.log(line))

          if (uiState.isLoadingModalInfo) {
            // Show loading state
            const modalLines = this.renderer.renderPackageInfoLoading(selectedState, terminalWidth, terminalHeight)
            modalLines.forEach((line) => console.log(line))
          } else {
            // Show full info
            const modalLines = this.renderer.renderPackageInfoModal(selectedState, terminalWidth, terminalHeight)
            modalLines.forEach((line) => console.log(line))
          }

          // Clear any remaining lines from previous render
          CursorUtils.clearToEndOfScreen()
          stateManager.markRendered([])
        } else {
          // Normal list view (flat rendering - no grouping)
          const terminalWidth = process.stdout.columns || 80
          const lines = this.renderer.renderInterface(
            filteredStates,
            uiState.currentRow,
            uiState.scrollOffset,
            uiState.maxVisibleItems,
            uiState.forceFullRender,
            [], // No renderable items - use flat rendering
            dependencyTypeLabel, // Show which dependency type we're upgrading
            this.packageManager, // Pass package manager info for header
            uiState.filterMode,
            uiState.filterQuery,
            states.length,
            terminalWidth
          )

          // Print all lines
          lines.forEach((line) => console.log(line))

          // Clear any remaining lines from previous render
          if (!uiState.forceFullRender) {
            CursorUtils.clearToEndOfScreen()
          }

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
        keypress(process.stdin)
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(true)
        }
        process.stdin.resume()
        process.stdin.on('keypress', (str, key) => inputHandler.handleKeypress(str, key, states))

        // Setup resize handler
        process.on('SIGWINCH', handleResize)

        // Update terminal height directly before initial render to ensure correct dimensions
        // This handles cases where process.stdout.rows might not be accurate at startup
        const currentHeight = this.getTerminalHeight()
        if (stateManager.updateTerminalHeight(currentHeight)) {
          stateManager.resetForResize()
        }

        // Initial render
        renderInterface()
      } catch (error) {
        // Fallback to simple interface if raw mode fails
        console.log(chalk.yellow('Raw mode not available, using fallback interface...'))
        resolve(states)
      }
    })
  }

  public async confirmUpgrade(choices: PackageUpgradeChoice[]): Promise<boolean | null> {
    console.log(this.renderer.renderConfirmation(choices))

    return new Promise((resolve) => {
      const handleConfirm = (confirmed: boolean | null) => {
        resolve(confirmed)
      }

      const inputHandler = new ConfirmationInputHandler(handleConfirm)

      // Setup keypress handling
      try {
        keypress(process.stdin)
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(true)
        }
        CursorUtils.hide()
        process.stdin.resume()
        process.stdin.on('keypress', (str, key) => inputHandler.handleKeypress(str, key))
      } catch (error) {
        // Fallback to inquirer
        inquirer
          .prompt([
            {
              type: 'confirm',
              name: 'proceed',
              message: 'Proceed with upgrade?',
              default: true,
            },
          ])
          .then((answer) => resolve(answer.proceed))
          .catch(() => resolve(false))
      }
    })
  }
}
