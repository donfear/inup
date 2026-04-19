import chalk from 'chalk'
import { PackageDetector } from './package-detector'
import { InteractiveUI } from '../interactive-ui'
import { PackageUpgrader } from './upgrader'
import {
  PackageInfo,
  PackageLoadProgress,
  PackageSelectionState,
  UpgradeOptions,
  PackageManagerInfo,
} from '../types'
import { PackageManagerDetector } from '../services/package-manager-detector'
import { ConsoleUtils } from '../ui/utils'
import { getPerformanceTracker } from '../features/debug'

/**
 * Main orchestrator for the inup upgrade process
 */
export class UpgradeRunner {
  private detector: PackageDetector
  private ui: InteractiveUI
  private upgrader: PackageUpgrader
  private options?: UpgradeOptions
  private packageManager: PackageManagerInfo

  constructor(options?: UpgradeOptions) {
    this.options = options

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

      const selectionPromise = new Promise<any[]>((resolve, reject) => {
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

      let selectedChoices: any[] = await selectionPromise
      const outdatedPackages = this.detector.getOutdatedPackagesOnly(latestPackages)
      if (outdatedPackages.length === 0 && selectedChoices.length === 0) {
        console.log(chalk.green('✅ All packages are up to date!'))
        return
      }

      // Interactive selection and confirmation loop
      let shouldProceed: boolean | null = false

      while (true) {
        if (selectedChoices.length === 0) {
          console.log(chalk.yellow('No packages selected. Exiting...'))
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

  private checkPrerequisites(): void {
    // Check if package.json exists
    if (!this.detector.hasPackageJson()) {
      throw new Error('No package.json found in current directory')
    }
  }

  private validateSelectedChoices(selectedChoices: any[], allPackages: any[]): void {
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

/**
 * @deprecated Use UpgradeRunner instead
 */
export class PnpmUpgradeInteractive extends UpgradeRunner {}
