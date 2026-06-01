import chalk from 'chalk'
import * as semver from 'semver'
import { PackageDetector } from './package-detector'
import { InteractiveUI } from '../interactive-ui'
import { PackageUpgrader } from './upgrader'
import {
  HeadlessAdvisory,
  HeadlessOptions,
  HeadlessReport,
  HeadlessReportEntry,
  HeadlessVulnerability,
  HEADLESS_SCHEMA_VERSION,
  PackageInfo,
  PackageLoadProgress,
  PackageSelectionState,
  PackageUpgradeChoice,
  UpgradeOptions,
  PackageManagerInfo,
  VulnerabilitySeverity,
} from '../types'
import { PackageManagerDetector } from '../services/package-manager-detector'
import { fetchVulnerabilities, VulnerabilityInfo } from '../services'
import { toComparableVersion } from '../utils'
import { ConsoleUtils } from '../ui/utils'
import { getPerformanceTracker } from '../features/debug'

/**
 * Main orchestrator for the inup upgrade process
 */
export class UpgradeRunner {
  private detector: PackageDetector
  private ui: InteractiveUI
  private upgrader: PackageUpgrader
  private packageManager: PackageManagerInfo

  constructor(options?: UpgradeOptions) {
    // Detect package manager
    const cwd = options?.cwd || process.cwd()
    if (options?.packageManager) {
      this.packageManager = PackageManagerDetector.getInfo(options.packageManager)
    } else {
      this.packageManager = PackageManagerDetector.detect(cwd)
    }

    this.detector = new PackageDetector(options)
    this.ui = new InteractiveUI(this.packageManager, {
      showPeerDependencyVulnerabilities: options?.showPeerDependencyVulnerabilities ?? false,
      showOptionalDependencyVulnerabilities:
        options?.showOptionalDependencyVulnerabilities ?? false,
      saveExact: options?.saveExact ?? false,
    })
    this.upgrader = new PackageUpgrader(this.packageManager)
  }

  public async run(): Promise<void> {
    try {
      // Check prerequisites
      this.checkPrerequisites()

      const performanceTracker = getPerformanceTracker()
      performanceTracker.start()
      performanceTracker.setPackageManager(this.packageManager.name)

      const progress: PackageLoadProgress = {
        discovered: 0,
        resolved: 0,
        total: 0,
        failed: 0,
        isLoading: true,
      }
      let selectionStates: PackageSelectionState[] = []
      let refreshUI: (() => void) | undefined
      let latestPackages: PackageInfo[] = []
      let previousSelections: Map<string, 'none' | 'range' | 'latest'> | undefined

      const selectionPromise = new Promise<PackageUpgradeChoice[]>((resolve, reject) => {
        const streamPromise = this.detector.streamOutdatedPackages((event) => {
          if (event.type === 'initial') {
            progress.discovered = event.payload.progress.discovered
            progress.resolved = event.payload.progress.resolved
            progress.total = event.payload.progress.total
            progress.failed = event.payload.progress.failed
            progress.isLoading = event.payload.progress.isLoading

            selectionStates = []

            this.ui
              .selectPackagesToUpgradeProgressive(selectionStates, progress, (refresh) => {
                refreshUI = refresh
              })
              .then(resolve)
              .catch(reject)
          }

          if (event.type === 'batch') {
            latestPackages = latestPackages
              .filter((pkg) => !event.payload.batch.some((item) => item.packageName === pkg.name))
              .concat(event.payload.batch.flatMap((item) => item.packageInfo))
            progress.discovered = event.payload.progress.discovered
            progress.resolved = event.payload.progress.resolved
            progress.total = event.payload.progress.total
            progress.failed = event.payload.progress.failed
            progress.isLoading = event.payload.progress.isLoading
            performanceTracker.mark('firstBatch')
            this.ui.appendOutdatedBatchToSelectionStates(
              selectionStates,
              event.payload.batch,
              previousSelections
            )
            refreshUI?.()
          }

          if (event.type === 'complete') {
            latestPackages = event.payload.packages
            progress.discovered = event.payload.progress.discovered
            progress.resolved = event.payload.progress.resolved
            progress.total = event.payload.progress.total
            progress.failed = event.payload.progress.failed
            progress.isLoading = event.payload.progress.isLoading
            performanceTracker.mark('firstBatch')
            performanceTracker.mark('allLoaded')
            refreshUI?.()
          }
        })

        streamPromise.catch(reject)
      })

      let selectedChoices: PackageUpgradeChoice[] = await selectionPromise
      const outdatedPackages = this.detector.getOutdatedPackagesOnly(latestPackages)
      if (outdatedPackages.length === 0 && selectedChoices.length === 0) {
        console.log(chalk.green('✅ Everything is up to date — no upgrades needed.'))
        return
      }

      // Interactive selection and confirmation loop
      let shouldProceed: boolean | null = false

      while (true) {
        if (selectedChoices.length === 0) {
          console.log(chalk.yellow('Nothing selected — no changes made.'))
          return
        }

        // Validate selected choices before confirmation
        this.validateSelectedChoices(selectedChoices, latestPackages)

        // Store current selections for potential return to selection
        previousSelections = new Map()
        // Convert selectedChoices back to selection state format
        // Group by package name and version specifier
        const choiceMap = new Map<string, 'range' | 'latest'>()
        selectedChoices.forEach((choice) => {
          const key = `${choice.name}@${choice.currentVersionSpecifier}@${choice.dependencyType}`
          choiceMap.set(key, choice.upgradeType as 'range' | 'latest')
        })
        // Convert to the format expected by selectPackagesToUpgrade
        choiceMap.forEach((upgradeType, key) => {
          previousSelections!.set(key, upgradeType)
        })

        // Confirm upgrade
        shouldProceed = await this.ui.confirmUpgrade(selectedChoices)

        if (shouldProceed === null) {
          // User pressed N or ESC - go back to selection with current selections preserved
          ConsoleUtils.clearProgress()
          selectedChoices = progress.isLoading
            ? await this.ui.selectPackagesToUpgradeProgressive(
                selectionStates,
                progress,
                (refresh) => {
                  refreshUI = refresh
                }
              )
            : await this.ui.selectPackagesToUpgrade(latestPackages, previousSelections)
          continue
        }

        if (!shouldProceed) {
          console.log(chalk.yellow('Upgrade cancelled.'))
          return
        }

        // User confirmed - break out of loop and proceed
        break
      }

      // Perform upgrade
      await this.upgrader.upgradePackages(selectedChoices, latestPackages)
    } catch (error) {
      console.error(chalk.red(`Error: ${error}`))
      process.exit(1)
    }
  }

  /**
   * Non-interactive entry point: resolve the outdated list without rendering the
   * TUI, then either emit a JSON report (--json) or a plain line-based report.
   * With --check, sets a non-zero exit code when updates exist so CI can gate on it.
   * Read-only: never writes package.json or installs.
   */
  public async runHeadless(options: HeadlessOptions): Promise<void> {
    try {
      this.checkPrerequisites()

      const packages = await this.detector.getOutdatedPackages()
      const outdated = this.detector.getOutdatedPackagesOnly(packages)

      // Audit the current versions (one bulk request, best-effort) and cross-reference each
      // advisory against the upgrade targets, so the report says whether upgrading *fixes* it.
      const vulnerabilities = await this.auditVulnerabilities(outdated)

      if (options.json) {
        // stdout is reserved for the JSON document only.
        console.log(
          JSON.stringify(this.buildHeadlessReport(packages, outdated, vulnerabilities), null, 2)
        )
      } else {
        this.printPlainReport(outdated, vulnerabilities)
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

  private buildHeadlessReport(
    all: PackageInfo[],
    outdated: PackageInfo[],
    vulnerabilities: Map<PackageInfo, HeadlessVulnerability>
  ): HeadlessReport {
    return {
      schemaVersion: HEADLESS_SCHEMA_VERSION,
      summary: {
        total: all.length,
        outdated: outdated.length,
        major: outdated.filter((pkg) => pkg.hasMajorUpdate).length,
        vulnerable: vulnerabilities.size,
      },
      outdated: outdated.map((pkg) => {
        const entry: HeadlessReportEntry = {
          name: pkg.name,
          current: pkg.currentVersion,
          range: pkg.rangeVersion,
          latest: pkg.latestVersion,
          type: pkg.type,
          packageJsonPath: pkg.packageJsonPath,
          hasMajorUpdate: pkg.hasMajorUpdate,
        }
        if (pkg.deprecated) entry.deprecated = pkg.deprecated
        if (pkg.enginesNode) entry.enginesNode = pkg.enginesNode
        const vulnerability = vulnerabilities.get(pkg)
        if (vulnerability) entry.vulnerability = vulnerability
        return entry
      }),
    }
  }

  /**
   * Audit the outdated packages' currently-installed versions (one bulk request, matching the
   * interactive audit) and, for each advisory, cross-reference its affected range against the
   * upgrade targets — so the report states whether upgrading actually *fixes* the issue.
   *
   * Best-effort: `fetchVulnerabilities` swallows network errors and returns an empty map, so a
   * failed audit never blocks the report. Returns only the vulnerable packages, keyed by package.
   */
  private async auditVulnerabilities(
    outdated: PackageInfo[]
  ): Promise<Map<PackageInfo, HeadlessVulnerability>> {
    const result = new Map<PackageInfo, HeadlessVulnerability>()
    if (outdated.length === 0) return result

    // The bulk advisory API is keyed by package name (one version per name), so dedupe by name.
    const versions = new Map<string, string>()
    for (const pkg of outdated) {
      if (!versions.has(pkg.name)) versions.set(pkg.name, pkg.currentVersion)
    }

    const advisories = await fetchVulnerabilities(versions)
    if (advisories.size === 0) return result

    for (const pkg of outdated) {
      const found = advisories.get(pkg.name)
      if (!found || found.vulnerabilities.length === 0 || !found.highestSeverity) continue
      result.set(
        pkg,
        this.summarizeVulnerability(pkg, found.vulnerabilities, found.highestSeverity)
      )
    }
    return result
  }

  private summarizeVulnerability(
    pkg: PackageInfo,
    vulnerabilities: VulnerabilityInfo[],
    highestSeverity: VulnerabilitySeverity
  ): HeadlessVulnerability {
    const advisories: HeadlessAdvisory[] = vulnerabilities.map((vuln) => ({
      id: vuln.id,
      title: vuln.title,
      severity: vuln.severity,
      url: vuln.url,
      vulnerableVersions: vuln.vulnerable_versions,
      fixedByRange: this.upgradeClears(pkg.rangeVersion, vuln.vulnerable_versions),
      fixedByLatest: this.upgradeClears(pkg.latestVersion, vuln.vulnerable_versions),
    }))

    return {
      count: advisories.length,
      highestSeverity,
      fixedByRange: advisories.every((advisory) => advisory.fixedByRange),
      fixedByLatest: advisories.every((advisory) => advisory.fixedByLatest),
      advisories,
    }
  }

  /**
   * True when upgrading to `target` escapes an advisory's affected range. Conservative: if either
   * the target or the advisory range can't be parsed, we do NOT claim a fix.
   */
  private upgradeClears(target: string, vulnerableVersions: string): boolean {
    const comparable = toComparableVersion(target)
    if (!comparable) return false
    try {
      return !semver.satisfies(comparable, vulnerableVersions, { includePrerelease: true })
    } catch {
      return false
    }
  }

  private printPlainReport(
    outdated: PackageInfo[],
    vulnerabilities: Map<PackageInfo, HeadlessVulnerability>
  ): void {
    if (outdated.length === 0) {
      console.log('All dependencies are up to date — no upgrades needed.')
      return
    }

    for (const pkg of outdated) {
      const major = pkg.hasMajorUpdate ? ' (major)' : ''
      const deprecated = pkg.deprecated ? '  [deprecated]' : ''
      console.log(
        `${pkg.name}  ${pkg.currentVersion} → ${pkg.latestVersion}  [${pkg.type}]${major}${this.vulnMarker(vulnerabilities.get(pkg))}${deprecated}`
      )
    }

    const fileCount = new Set(outdated.map((pkg) => pkg.packageJsonPath)).size
    const vulnNote =
      vulnerabilities.size > 0 ? ` — ${vulnerabilities.size} with known vulnerabilities` : ''
    console.log(`\n${outdated.length} package(s) outdated across ${fileCount} file(s)${vulnNote}.`)
  }

  /** A compact `[vuln: N sev → verdict]` tag for the plain report; '' when there are none. */
  private vulnMarker(vulnerability: HeadlessVulnerability | undefined): string {
    if (!vulnerability) return ''
    // Prefer the cheaper fix: if the in-range bump already clears it, that's the safer action.
    const verdict = vulnerability.fixedByRange
      ? 'fixed by range upgrade'
      : vulnerability.fixedByLatest
        ? 'fixed by latest only'
        : 'not fixed by upgrade'
    return `  [vuln: ${vulnerability.count} ${vulnerability.highestSeverity} → ${verdict}]`
  }

  private checkPrerequisites(): void {
    // Check if package.json exists
    if (!this.detector.hasPackageJson()) {
      throw new Error('No package.json found in current directory')
    }
  }

  private validateSelectedChoices(
    selectedChoices: PackageUpgradeChoice[],
    allPackages: PackageInfo[]
  ): void {
    // Validate that all selected packages have valid target versions
    const invalidChoices = selectedChoices.filter((choice) => {
      const packageInfo = allPackages.find(
        (pkg) =>
          pkg.name === choice.name &&
          pkg.packageJsonPath === choice.packageJsonPath &&
          pkg.type === choice.dependencyType
      )
      return !packageInfo || !choice.targetVersion
    })

    if (invalidChoices.length > 0) {
      throw new Error(
        `Invalid selections detected: ${invalidChoices.map((c) => c.name).join(', ')}. Please review your selections.`
      )
    }

    // Print summary of what will be upgraded
    const packageJsonPaths = new Set(selectedChoices.map((c) => c.packageJsonPath))
    const uniquePackages = new Set(selectedChoices.map((c) => c.name))

    console.log('\n' + chalk.bold('📋 Upgrade Summary'))
    console.log(chalk.gray('─'.repeat(50)))
    console.log(`${chalk.cyan(uniquePackages.size.toString())} package(s) will be upgraded`)
    console.log(
      `${chalk.cyan(packageJsonPaths.size.toString())} package.json file(s) will be modified`
    )

    const rangeUpgrades = selectedChoices.filter((c) => c.upgradeType === 'range').length
    const majorUpgrades = selectedChoices.filter((c) => c.upgradeType === 'latest').length

    if (rangeUpgrades > 0) {
      console.log(`  ${chalk.yellow('●')} ${rangeUpgrades} minor/patch upgrade(s)`)
    }
    if (majorUpgrades > 0) {
      console.log(`  ${chalk.red('●')} ${majorUpgrades} major upgrade(s)`)
    }
    console.log(chalk.gray('─'.repeat(50)))
  }
}
