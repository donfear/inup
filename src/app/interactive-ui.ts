import type { Key } from 'node:readline'
import { VulnerabilityAuditController } from '../features/audit'
import {
  ConfirmationInputHandler,
  createPendingSelectionStates,
  createSelectionStates,
  createUpgradeChoices,
  PackageInfoModalController,
  runInteractiveSession,
  selectionKey,
  UIRenderer,
} from '../features/interactive'
import { CursorUtils, TerminalInput } from '../shared/terminal'
import type {
  PackageInfo,
  PackageLoadProgress,
  PackageManagerInfo,
  PackageSelectionState,
  PackageUpgradeChoice,
  StreamOutdatedPackagesBatchItem,
  VulnerabilityDisplayOptions,
} from '../shared/types'

interface InteractiveUIOptions extends VulnerabilityDisplayOptions {
  saveExact?: boolean
}

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
  private readonly options: Required<VulnerabilityDisplayOptions>
  private readonly saveExact: boolean
  private readonly vulnerabilityAuditController = new VulnerabilityAuditController()
  private readonly packageInfoModalController = new PackageInfoModalController()
  private refreshView?: () => void

  constructor(packageManager: PackageManagerInfo, options?: InteractiveUIOptions) {
    this.renderer = new UIRenderer()
    this.packageManager = packageManager
    this.options = normalizeVulnerabilityDisplayOptions(options)
    this.saveExact = options?.saveExact ?? false
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

    const selectedStates = await runInteractiveSession(
      selectionStates,
      this.packageManager,
      this.renderer,
      this.packageInfoModalController,
      this.vulnerabilityAuditController,
      this.options,
      (refresh) => {
        this.refreshView = refresh
      }
    )
    return createUpgradeChoices(selectedStates, this.saveExact)
  }

  public createSelectionStates(
    packages: PackageInfo[],
    previousSelections?: Map<string, 'none' | 'range' | 'latest'>,
    includeUpToDate: boolean = true
  ): PackageSelectionState[] {
    return createSelectionStates(
      packages,
      (name, version, type) =>
        this.vulnerabilityAuditController.getCachedSummary(name, version, type),
      previousSelections,
      includeUpToDate
    )
  }

  public createPendingSelectionStates(
    packages: Array<
      Pick<PackageInfo, 'name' | 'currentVersion' | 'type' | 'packageJsonPath' | 'catalog'>
    >,
    previousSelections?: Map<string, 'none' | 'range' | 'latest'>
  ): PackageSelectionState[] {
    return createPendingSelectionStates(
      packages,
      (name, version, type) =>
        this.vulnerabilityAuditController.getCachedSummary(name, version, type),
      previousSelections
    )
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
      selectionStates.map((state) =>
        selectionKey(state.name, state.currentVersionSpecifier, state.type, state.catalog)
      )
    )

    outdatedStates.forEach((state) => {
      const key = selectionKey(state.name, state.currentVersionSpecifier, state.type, state.catalog)
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
    const selectedStates = await runInteractiveSession(
      selectionStates,
      this.packageManager,
      this.renderer,
      this.packageInfoModalController,
      this.vulnerabilityAuditController,
      this.options,
      (refresh) => {
        this.refreshView = refresh
      },
      progress,
      attachRefresh
    )
    return createUpgradeChoices(selectedStates, this.saveExact)
  }

  public enqueueSecurityAudit(selectionStates: PackageSelectionState[]): void {
    this.vulnerabilityAuditController.enqueueStates(selectionStates, () => this.refreshView?.())
  }

  public async confirmUpgrade(choices: PackageUpgradeChoice[]): Promise<boolean | null> {
    console.log(this.renderer.renderConfirmation(choices))

    return new Promise((resolve) => {
      // Replaced synchronously below before any keypress can invoke it.
      let cleanupConfirmationSession = /* v8 ignore next */ () => {
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
      // Coverage: the body only runs during a real process 'exit' event, which
      // cannot be fired safely inside the test process.
      /* v8 ignore start */
      const confirmEmergencyCleanup = () => {
        process.stdout.write('\x1b[?25h')
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(false)
        }
      }
      /* v8 ignore stop */
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
      } catch {
        process.off('exit', confirmEmergencyCleanup)
        TerminalInput.promptForConfirmation('Proceed with upgrade? [Y/n] ')
          .then(resolve)
          .catch(() => resolve(false))
      }
    })
  }
}
