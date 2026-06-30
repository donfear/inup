import chalk from 'chalk'
import { PackageDetector } from '../../core/package-detector'
import { PackageUpgrader } from '../../core/upgrader'
import { PackageManagerDetector } from '../../services/package-manager-detector'
import { applyVersionPrefix } from '../../ui/utils/version'
import type { PackageInfo, PackageUpgradeChoice, UpgradeOptions } from '../../types'
import { auditVulnerabilities } from './vulnerability-audit'
import { buildHeadlessReport, renderPlainReport } from './report'
import { ApplyTarget, HeadlessOptions } from './types'
import {
  getPerformanceTracker,
  isPerfLoggingEnabled,
  perfEnv,
  writePerfLog,
} from '../../features/debug'

/**
 * Non-interactive entry point. Resolves the outdated list without rendering the TUI, then either
 * emits a JSON report (--json) or a plain line-based report. With --check, sets a non-zero exit
 * code when updates exist so CI can gate on it. With --apply, writes the bumps to package.json and
 * runs install — the only non-interactive write path.
 *
 * This is the headless counterpart to the interactive `UpgradeRunner`; it shares the
 * `PackageDetector` (scan/resolve) and, for --apply, the `PackageUpgrader` (write + install).
 */
export class HeadlessRunner {
  private detector: PackageDetector
  private options?: UpgradeOptions

  constructor(options?: UpgradeOptions) {
    this.options = options
    this.detector = new PackageDetector(options)
  }

  async run(options: HeadlessOptions): Promise<void> {
    try {
      if (!this.detector.hasPackageJson()) {
        throw new Error('No package.json found in current directory')
      }

      // Start perf tracking so headless runs produce clean timing data too
      // (the interactive runner starts it itself; headless previously did not).
      const perfEnabled = isPerfLoggingEnabled()
      const performanceTracker = getPerformanceTracker()
      if (perfEnabled) performanceTracker.start()

      const packages = await this.detector.getOutdatedPackages()
      const outdated = this.detector.getOutdatedPackagesOnly(packages)

      if (perfEnabled) {
        performanceTracker.mark('allLoaded')
        writePerfLog(
          {
            ...this.detector.getPerfConfig(),
            packageManager: null,
            mode: 'headless',
            env: perfEnv(),
          },
          performanceTracker.snapshot()
        )
      }

      // Audit the current versions (one bulk request, best-effort) and cross-reference each
      // advisory against the upgrade targets, so the report says whether upgrading *fixes* it.
      const vulnerabilities = await auditVulnerabilities(outdated)

      // Build the report from the *pre-apply* outdated set: it describes what this run addressed.
      const report = buildHeadlessReport(packages, outdated, vulnerabilities)

      // --apply writes the bumps + lockfile. The scan above already honored .inuprc
      // (ignore/exclude/scanDirs), so the set we write is exactly the set we report — never more.
      if (options.apply) {
        await this.applyUpgrades(outdated, options.target ?? 'minor', !!options.json)
      }

      if (options.json) {
        // stdout is reserved for the JSON document only.
        console.log(JSON.stringify(report, null, 2))
      } else if (!options.apply) {
        console.log(renderPlainReport(outdated, vulnerabilities))
      }

      // Exit 1 only means "updates exist" (like `prettier --check`); 2 is reserved for errors.
      if (options.check && outdated.length > 0) {
        process.exitCode = 1
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
      process.exit(2)
    }
  }

  /**
   * Apply upgrades to the already-filtered outdated set, by version policy. Reuses the interactive
   * write path (`PackageUpgrader`) verbatim — we only build the choices programmatically instead of
   * from a TUI selection. No path/package filtering happens here: `outdated` is config-filtered.
   */
  private async applyUpgrades(
    outdated: PackageInfo[],
    target: ApplyTarget,
    json: boolean
  ): Promise<void> {
    const choices = this.buildChoices(outdated, target)
    if (choices.length === 0) return

    const packageManager = this.resolvePackageManager()
    // With --json, run the upgrader quietly: its own progress + the install child's stdout go to
    // stderr, leaving stdout for the JSON document only.
    const upgrader = new PackageUpgrader(packageManager, { quiet: json })
    await upgrader.upgradePackages(choices, outdated)
  }

  /**
   * Build `PackageUpgradeChoice[]` from the outdated set per the version policy. Mirrors
   * `createUpgradeChoices` in the TUI: preserves the original range prefix (^/~) unless --save-exact.
   *
   * - minor/patch: take the in-range target (`rangeVersion`); skip packages whose only update is a
   *   major (no in-range bump). Uses upgradeType 'range'.
   * - latest: take `latestVersion`; uses upgradeType 'latest' (majors included).
   */
  private buildChoices(outdated: PackageInfo[], target: ApplyTarget): PackageUpgradeChoice[] {
    const saveExact = this.options?.saveExact ?? false
    const choices: PackageUpgradeChoice[] = []

    for (const pkg of outdated) {
      const useLatest = target === 'latest'

      // minor/patch only act on packages with an in-range bump; major-only updates are skipped.
      if (!useLatest && !pkg.hasRangeUpdate) continue

      const targetVersion = useLatest ? pkg.latestVersion : pkg.rangeVersion
      if (!targetVersion) continue

      const targetVersionWithPrefix = saveExact
        ? targetVersion
        : applyVersionPrefix(pkg.currentVersion, targetVersion)

      choices.push({
        name: pkg.name,
        packageJsonPath: pkg.packageJsonPath,
        dependencyType: pkg.type,
        upgradeType: useLatest ? 'latest' : 'range',
        targetVersion: targetVersionWithPrefix,
        currentVersionSpecifier: pkg.currentVersion,
      })
    }

    return choices
  }

  /** Resolve the package manager the same way the interactive runner does. */
  private resolvePackageManager() {
    const cwd = this.options?.cwd || process.cwd()
    return this.options?.packageManager
      ? PackageManagerDetector.getInfo(this.options.packageManager)
      : PackageManagerDetector.detect(cwd)
  }
}
