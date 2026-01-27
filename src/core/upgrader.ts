import chalk from 'chalk'
import { createSpinner } from 'nanospinner'
import { existsSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { PackageInfo, PackageUpgradeChoice, PackageManagerInfo } from '../types'
import { executeCommand, findWorkspaceRoot, readPackageJson } from '../utils'

export class PackageUpgrader {
  private packageManager: PackageManagerInfo

  constructor(packageManager: PackageManagerInfo) {
    this.packageManager = packageManager
  }

  public async upgradePackages(
    choices: PackageUpgradeChoice[],
    packageInfos: PackageInfo[]
  ): Promise<void> {
    if (choices.length === 0) {
      console.log(chalk.yellow('No packages to upgrade.'))
      return
    }

    // Group choices by package.json path and dependency type
    const choicesByFileAndType = this.groupChoicesByFileAndType(choices, packageInfos)

    for (const [fileAndType, choiceList] of Object.entries(choicesByFileAndType)) {
      if (choiceList.length === 0) continue

      const [packageJsonPath, type] = fileAndType.split('|')
      console.log(`Processing ${type} in ${packageJsonPath}`)
      await this.upgradeChoiceGroup(choiceList, packageJsonPath, type as any)
    }

    // Count unique packages upgraded
    const uniquePackages = new Set(choices.map((c) => c.name))
    console.log(chalk.green(`\n✅ Successfully upgraded ${uniquePackages.size} package(s)!`))

    // Execute package manager install after all upgrades are complete
    await this.runInstall(choices, packageInfos)
  }

  private async runInstall(
    choices: PackageUpgradeChoice[],
    packageInfos: PackageInfo[]
  ): Promise<void> {
    if (choices.length === 0) {
      return
    }

    // Determine the directory to run install in
    // Use workspace root if it exists, otherwise use the directory of the first package.json
    const firstPackageJsonPath = choices[0].packageJsonPath
    const firstPackageDir = dirname(firstPackageJsonPath)
    const workspaceRoot = findWorkspaceRoot(firstPackageDir, this.packageManager.name)
    const installDir = workspaceRoot || firstPackageDir

    // Check if package manager is installed
    try {
      executeCommand(`${this.packageManager.name} --version`, installDir)
    } catch (error) {
      console.log(
        chalk.yellow(
          `\n⚠️  ${this.packageManager.displayName} is detected but not installed on your system.\n` +
            `Please run the install command manually:\n` +
            `  cd ${installDir}\n` +
            `  ${this.packageManager.installCommand}\n`
        )
      )
      return // Skip install, let user do it manually
    }

    const spinner = createSpinner(`Running ${this.packageManager.displayName} install...`).start()

    try {
      executeCommand(this.packageManager.installCommand, installDir)
      spinner.success()
    } catch (error) {
      spinner.error()
      console.error(chalk.red(`Error: ${error}`))
      throw error
    }
  }

  private groupChoicesByFileAndType(
    choices: PackageUpgradeChoice[],
    packageInfos: PackageInfo[]
  ): Record<string, PackageUpgradeChoice[]> {
    const groups: Record<string, PackageUpgradeChoice[]> = {}

    choices.forEach((choice) => {
      const info = packageInfos.find(
        (p) => p.name === choice.name && p.packageJsonPath === choice.packageJsonPath
      )
      if (info) {
        const key = `${choice.packageJsonPath}|${info.type}`
        if (!groups[key]) {
          groups[key] = []
        }
        groups[key].push(choice)
      }
    })

    return groups
  }

  private async upgradeChoiceGroup(
    choices: PackageUpgradeChoice[],
    packageJsonPath: string,
    type: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies'
  ): Promise<void> {
    // Validate that package.json exists
    if (!existsSync(packageJsonPath)) {
      console.warn(
        chalk.yellow(`⚠️  Skipping ${type} in ${packageJsonPath} - package.json file not found`)
      )
      return
    }

    const packageDir = packageJsonPath.replace('/package.json', '')
    const spinner = createSpinner(`Upgrading ${type} in ${packageDir}...`).start()

    try {
      // Read the current package.json
      const packageJson = readPackageJson(packageJsonPath)

      // Find workspace root
      const workspaceRoot = findWorkspaceRoot(packageDir, this.packageManager.name)
      const isWorkspaceRoot = packageDir === workspaceRoot

      // Group by upgrade type (range vs latest)
      const rangeChoices = choices.filter((c) => c.upgradeType === 'range')
      const latestChoices = choices.filter((c) => c.upgradeType === 'latest')

      let modified = false

      // Upgrade range versions by directly modifying package.json
      if (rangeChoices.length > 0) {
        if (!packageJson[type]) {
          packageJson[type] = {}
        }

        rangeChoices.forEach((choice) => {
          packageJson[type]![choice.name] = choice.targetVersion
          modified = true
        })
      }

      // Upgrade to latest versions by directly modifying package.json
      if (latestChoices.length > 0) {
        if (!packageJson[type]) {
          packageJson[type] = {}
        }

        latestChoices.forEach((choice) => {
          packageJson[type]![choice.name] = choice.targetVersion
          modified = true
        })
      }

      // Write back the modified package.json
      if (modified) {
        writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n')
      }

      spinner.success({ text: `Upgraded ${choices.length} ${type} in ${packageDir}` })

      // Show which packages were upgraded
      choices.forEach((choice) => {
        const upgradeTypeColor = choice.upgradeType === 'range' ? chalk.yellow : chalk.red
        console.log(
          `  ${chalk.green('✓')} ${chalk.cyan(choice.name)} → ${upgradeTypeColor(choice.targetVersion)}`
        )
      })
    } catch (error) {
      spinner.error({ text: `Failed to upgrade ${type} in ${packageDir}` })
      console.error(chalk.red(`Error: ${error}`))
      throw error
    }
  }
}
