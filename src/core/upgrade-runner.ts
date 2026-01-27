import chalk from 'chalk'
import { PackageDetector } from './package-detector'
import { InteractiveUI } from '../interactive-ui'
import { PackageUpgrader } from './upgrader'
import { UpgradeOptions, PackageManagerInfo } from '../types'
import { PackageManagerDetector } from '../services/package-manager-detector'

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
    this.ui = new InteractiveUI(this.packageManager)
    this.upgrader = new PackageUpgrader(this.packageManager)
  }

  public async run(): Promise<void> {
    try {
      // Check prerequisites
      this.checkPrerequisites()

      // Detect packages
      const packages = await this.detector.getOutdatedPackages()

      // Display packages table
      await this.ui.displayPackagesTable(packages)

      const outdatedPackages = this.detector.getOutdatedPackagesOnly(packages)
      if (outdatedPackages.length === 0) {
        return
      }

      // Interactive selection and confirmation loop
      let selectedChoices: any[] = []
      let shouldProceed: boolean | null = false
      let previousSelections: Map<string, 'none' | 'range' | 'latest'> | undefined

      while (true) {
        // Interactive selection (pass options for filtering)
        selectedChoices = await this.ui.selectPackagesToUpgrade(packages, previousSelections, {
          includePeerDeps: this.options?.includePeerDeps,
          includeOptionalDeps: this.options?.includeOptionalDeps,
        })

        if (selectedChoices.length === 0) {
          console.log(chalk.yellow('No packages selected. Exiting...'))
          return
        }

        // Validate selected choices before confirmation
        this.validateSelectedChoices(selectedChoices, packages)

        // Store current selections for potential return to selection
        previousSelections = new Map()
        // Convert selectedChoices back to selection state format
        // Group by package name and version specifier
        const choiceMap = new Map<string, 'range' | 'latest'>()
        selectedChoices.forEach((choice) => {
          const key = `${choice.name}@${choice.currentVersionSpecifier}`
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
          console.clear()
          console.log(chalk.bold.blue('🚀 inup\n'))
          // previousSelections is already set from above
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
      await this.upgrader.upgradePackages(selectedChoices, packages)
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
        (pkg) => pkg.name === choice.name && pkg.packageJsonPath === choice.packageJsonPath
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
