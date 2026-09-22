import chalk from 'chalk'
import {
  getPerformanceTracker,
  isPerfLoggingEnabled,
  perfEnv,
  writePerfLog,
} from '../../features/debug'
import { PackageManagerDetector } from '../../shared/package-manager'
import { ConsoleUtils, truncatePlainText } from '../../shared/terminal'
import type { PackageInfo, PackageUpgradeChoice, UpgradeOptions } from '../../shared/types'
import { applyVersionPrefix, findHighestPatchVersion } from '../../shared/versions'
import { auditVulnerabilities, fetchVulnerabilities, type PackageVulnerabilities } from '../audit'
import { PackageDetector, PackageUpgrader } from '../upgrade'
import { buildHeadlessReport, renderPlainReport } from './report'
import type { ApplyTarget, HeadlessOptions } from './types'

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

      // The bulk advisory request needs only name → declared specifier, which the
      // detector knows before it touches the registry. Start it from the `initial`
      // event so it overlaps the fetch instead of adding a round-trip at the end.
      // Best-effort like the audit itself: a failure resolves to an empty map.
      // The detector always emits `initial` before `complete`; the empty default only
      // gives the variable a value until then.
      let advisories: Promise<Map<string, PackageVulnerabilities>> = Promise.resolve(new Map())
      let packages: PackageInfo[] = []
      await this.detector.streamOutdatedPackages((event) => {
        if (event.type === 'warning') {
          console.warn(chalk.yellow(event.payload.message))
        } else if (event.type === 'status') {
          const { phase, packageJsonFiles, scanningDir } = event.payload.progress
          const count = packageJsonFiles ?? 0
          const showProgress = (message: string) =>
            ConsoleUtils.showProgress(truncatePlainText(message, process.stderr.columns || 80))
          switch (phase) {
            case 'discovering':
              showProgress(
                scanningDir
                  ? `Scanning ${scanningDir} (found ${count})`
                  : 'Scanning repository for package.json files…'
              )
              break
            case 'collecting':
              showProgress(`Found ${count} package.json file${count === 1 ? '' : 's'}`)
              showProgress('Reading dependencies…')
              break
            case 'resolving':
              showProgress('Identifying unique packages…')
              break
            case 'done':
              break
          }
        } else if (event.type === 'initial') {
          advisories = fetchVulnerabilities(event.payload.currentVersions)
        } else if (event.type === 'complete') {
          packages = event.payload.packages
          ConsoleUtils.clearProgress()
        }
      })
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
      const vulnerabilities = await auditVulnerabilities(outdated, advisories)

      // Build the report from the *pre-apply* outdated set: it describes what this run addressed.
      const cooldown = this.detector.getCooldownDiagnostics()
      const report = buildHeadlessReport(packages, outdated, vulnerabilities, cooldown)

      // A cooldown that could not act must say so. It fails open on missing publish times, so
      // staying quiet here would present an inert control as a satisfied one — and this is the
      // path CI gates on. stderr keeps `--json` stdout a pure document.
      if (cooldown && !cooldown.publishTimesAvailable) {
        console.error(
          chalk.yellow(
            `Warning: --minimum-release-age ${cooldown.minimumReleaseAge} had no effect — the registry did not return publish times for any package.`
          )
        )
      }

      // --apply writes the bumps + lockfile. The scan above already honored .inuprc
      // (ignore/exclude/scanDirs), so the set we write is exactly the set we report — never more.
      if (options.apply) {
        await this.applyUpgrades(outdated, options.target ?? 'minor', !!options.json)
      }

      if (options.json) {
        // stdout is reserved for the JSON document only.
        console.log(JSON.stringify(report, null, 2))
      } else if (!options.apply) {
        console.log(renderPlainReport(outdated, vulnerabilities, packages))
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

    const packageManager = PackageManagerDetector.resolve(this.options)
    // With --json, run the upgrader quietly: its own progress + the install child's stdout go to
    // stderr, leaving stdout for the JSON document only.
    const upgrader = new PackageUpgrader(packageManager, { quiet: json })
    await upgrader.upgradePackages(choices, outdated)
  }

  /**
   * Build `PackageUpgradeChoice[]` from the outdated set per the version policy. Mirrors
   * `createUpgradeChoices` in the TUI: preserves the original range prefix (^/~) unless --save-exact.
   *
   * - minor: take the in-range target (`rangeVersion`); skip packages whose only update is a
   *   major (no in-range bump). Uses upgradeType 'range'.
   * - patch: take the highest patch in the current major.minor line; skip packages whose only
   *   update crosses a minor (or major) boundary. Uses upgradeType 'range'.
   * - latest: take `latestVersion`; uses upgradeType 'latest' (majors included).
   */
  private buildChoices(outdated: PackageInfo[], target: ApplyTarget): PackageUpgradeChoice[] {
    const saveExact = this.options?.saveExact ?? false
    const choices: PackageUpgradeChoice[] = []

    for (const pkg of outdated) {
      const targetVersion = this.resolveTargetVersion(pkg, target)
      if (!targetVersion) continue

      const targetVersionWithPrefix = saveExact
        ? targetVersion
        : applyVersionPrefix(pkg.currentVersion, targetVersion)

      choices.push({
        name: pkg.name,
        packageJsonPath: pkg.packageJsonPath,
        dependencyType: pkg.type,
        upgradeType: target === 'latest' ? 'latest' : 'range',
        targetVersion: targetVersionWithPrefix,
        currentVersionSpecifier: pkg.currentVersion,
        catalog: pkg.catalog,
      })
    }

    return choices
  }

  /** Resolve the version a package should be bumped to under the given policy, or null to skip. */
  private resolveTargetVersion(pkg: PackageInfo, target: ApplyTarget): string | null {
    if (target === 'latest') {
      // ignoreMajor holds matched packages to their in-range bump even under
      // --target latest; without a range update there is nothing to write.
      if (pkg.majorIgnored) {
        return pkg.hasRangeUpdate ? pkg.rangeVersion || null : null
      }
      return pkg.latestVersion || null
    }
    if (target === 'patch') {
      // Strictly patch-level: computed from the full version list, not `rangeVersion` (which may
      // be a minor bump). Null when the only updates cross a minor boundary.
      return findHighestPatchVersion(pkg.currentVersion, pkg.allVersions ?? [])
    }
    // minor: in-range bump only; major-only updates are skipped.
    if (!pkg.hasRangeUpdate) return null
    return pkg.rangeVersion || null
  }
}
