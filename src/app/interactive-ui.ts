import type { Key } from 'node:readline'
import { VulnerabilityAuditController } from '../features/audit'
import {
  ConfirmationInputHandler,
  createSelectionStates,
  createUpgradeChoices,
  type InteractiveSessionHandle,
  PackageInfoModalController,
  runInteractiveSession,
  SelectionList,
  type SessionDisplayOptions,
  UIRenderer,
} from '../features/interactive'
import { CursorUtils, TerminalInput } from '../shared/terminal'
import type {
  CooldownRenderStatus,
  PackageInfo,
  PackageLoadProgress,
  PackageManagerInfo,
  PackageSelectionState,
  PackageUpgradeChoice,
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
  /**
   * One live object, handed to the session by reference and mutated by the setters below.
   *
   * The picker mounts before scanning starts, so a value copied into the session's options
   * at mount time would stay at its initial zero for the whole run — the runner only learns
   * what the cooldown held once packages resolve. Same shape as the live progress object.
   */
  private readonly cooldown: CooldownRenderStatus = { heldCount: 0, unsupported: false }

  public setCooldownHeldCount(count: number): void {
    this.cooldown.heldCount = count
  }

  public setCooldownUnsupported(unsupported: boolean): void {
    this.cooldown.unsupported = unsupported
  }

  private sessionOptions(): SessionDisplayOptions {
    return { ...this.options, cooldown: this.cooldown }
  }
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

  public async selectPackagesToUpgrade(
    packages: PackageInfo[],
    previousSelections?: Map<string, 'none' | 'range' | 'latest'>
  ): Promise<PackageUpgradeChoice[]> {
    const selectionStates = this.createSelectionStates(packages, previousSelections, false)
    if (selectionStates.length === 0) {
      return []
    }

    const selectedStates = await runInteractiveSession(
      new SelectionList(selectionStates),
      this.packageManager,
      this.renderer,
      this.packageInfoModalController,
      this.vulnerabilityAuditController,
      this.sessionOptions(),
      (session) => {
        this.refreshView = session?.refresh
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

  /**
   * Adds the rows of one streamed package to the list at their sorted position and audits
   * just the ones that were new.
   *
   * "Rows" means outdated declarations plus any the cooldown emptied out — the latter have
   * nothing to select, but they are the packages a user most needs to be told about, and
   * they stay filtered out of the default view.
   */
  public insertResolvedPackages(
    selection: SelectionList,
    packageInfo: PackageInfo[],
    previousSelections?: Map<string, 'none' | 'range' | 'latest'>
  ): void {
    const rows = this.createSelectionStates(packageInfo, previousSelections, false)
    const inserted = selection.insert(rows)
    if (inserted.length > 0) this.enqueueSecurityAudit(inserted, selection.items)
  }

  /**
   * Runs the session over a list that is still filling. The caller receives
   * a handle for background refreshes and failures, revoked during teardown.
   */
  public async selectPackagesToUpgradeProgressive(
    selection: SelectionList,
    progress: PackageLoadProgress,
    attachSession: (session: InteractiveSessionHandle | undefined) => void
  ): Promise<PackageUpgradeChoice[]> {
    this.enqueueSecurityAudit(selection.items)
    const selectedStates = await runInteractiveSession(
      selection,
      this.packageManager,
      this.renderer,
      this.packageInfoModalController,
      this.vulnerabilityAuditController,
      this.sessionOptions(),
      (session) => {
        this.refreshView = session?.refresh
        attachSession(session)
      },
      progress
    )
    return createUpgradeChoices(selectedStates, this.saveExact)
  }

  public enqueueSecurityAudit(
    states: PackageSelectionState[],
    applyTo: PackageSelectionState[] = states
  ): void {
    this.vulnerabilityAuditController.enqueueStates(states, () => this.refreshView?.(), applyTo)
  }

  public async confirmUpgrade(choices: PackageUpgradeChoice[]): Promise<boolean | null> {
    console.log(this.renderer.renderConfirmation(choices))

    return new Promise((resolve) => {
      // Replaced synchronously below before any keypress can invoke it, so
      // the placeholder body is unreachable. (The `v8 ignore next` form is
      // not honored by coverage-v8 here; the block form is.)
      /* v8 ignore start */
      let cleanupConfirmationSession = () => {
        CursorUtils.show()
      }
      /* v8 ignore stop */

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
