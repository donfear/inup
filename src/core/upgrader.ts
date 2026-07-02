import chalk from 'chalk'
import { createSpinner } from 'nanospinner'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { spawnSync, type StdioOptions } from 'child_process'
import {
  PackageInfo,
  PackageUpgradeChoice,
  PackageManagerInfo,
  DependencyType,
} from '../shared/types'
import { detectJsonFormat, executeCommand, findWorkspaceRoot, readPackageJson } from '../utils'

export interface PackageUpgraderOptions {
  /**
   * Keep stdout clean: route this class's own progress logs to stderr, and send the install
   * child's stdout to stderr too. Used by `--apply --json` so the JSON document on stdout is the
   * only thing there. The install child uses `stdio: 'inherit'`, so its stdout bypasses any
   * `process.stdout.write` shim — the only reliable fix is to redirect the fd at spawn time.
   */
  quiet?: boolean
}

export class PackageUpgrader {
  private packageManager: PackageManagerInfo
  private quiet: boolean
  /** When quiet, send our own progress to stderr so stdout stays reserved for the JSON document. */
  private log: (message?: unknown) => void

  constructor(packageManager: PackageManagerInfo, options?: PackageUpgraderOptions) {
    this.packageManager = packageManager
    this.quiet = options?.quiet ?? false
    this.log = this.quiet ? (msg) => console.error(msg) : (msg) => console.log(msg)
  }

  public async upgradePackages(
    choices: PackageUpgradeChoice[],
    _packageInfos: PackageInfo[]
  ): Promise<void> {
    if (choices.length === 0) {
      this.log(chalk.yellow('No packages to upgrade.'))
      return
    }

    // Group choices by package.json path and dependency type
    const choicesByFileAndType = this.groupChoicesByFileAndType(choices)

    for (const [fileAndType, choiceList] of Object.entries(choicesByFileAndType)) {
      if (choiceList.length === 0) continue

      const [packageJsonPath, type] = fileAndType.split('|')
      this.log(`Processing ${type} in ${packageJsonPath}`)
      await this.upgradeChoiceGroup(choiceList, packageJsonPath, type as DependencyType)
    }

    // Count unique packages upgraded
    const uniquePackages = new Set(choices.map((c) => c.name))
    this.log(chalk.green(`\n✅ Successfully upgraded ${uniquePackages.size} package(s)!`))

    // Execute package manager install after all upgrades are complete
    await this.runInstall(choices)
  }

  private async runInstall(choices: PackageUpgradeChoice[]): Promise<void> {
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
      this.log(
        chalk.yellow(
          `\n⚠️  ${this.packageManager.displayName} is detected but not installed on your system.\n` +
            `Please run the install command manually:\n` +
            `  cd ${installDir}\n` +
            `  ${this.packageManager.installCommand}\n`
        )
      )
      return // Skip install, let user do it manually
    }

    // We just rewrote package.json, so the install must be allowed to regenerate the lockfile.
    // pnpm/yarn default to frozen/immutable installs under CI; writeInstallCommand opts out.
    const installCommand =
      this.packageManager.writeInstallCommand ?? this.packageManager.installCommand

    this.log(chalk.cyan(`\n📦 Running ${installCommand}...\n`))

    // In quiet mode, send the install child's stdout to *our* stderr (fd 2). The child uses
    // inherited fds, so its progress output bypasses any JS shim — redirecting at spawn time is
    // the only reliable way to keep stdout reserved for the --json document. stderr stays inherited.
    const stdio: StdioOptions = this.quiet ? ['inherit', 2, 'inherit'] : 'inherit'

    const result = spawnSync(installCommand, {
      cwd: installDir,
      stdio,
      shell: true,
    })

    if (result.error) {
      throw result.error
    }

    if (result.status !== 0) {
      if (result.signal) {
        throw new Error(`${installCommand} terminated by signal ${result.signal}`)
      }
      throw new Error(`${installCommand} exited with code ${result.status}`)
    }
  }

  private groupChoicesByFileAndType(
    choices: PackageUpgradeChoice[]
  ): Record<string, PackageUpgradeChoice[]> {
    const groups: Record<string, PackageUpgradeChoice[]> = {}

    choices.forEach((choice) => {
      const key = `${choice.packageJsonPath}|${choice.dependencyType}`
      if (!groups[key]) {
        groups[key] = []
      }
      groups[key].push(choice)
    })

    return groups
  }

  private async upgradeChoiceGroup(
    choices: PackageUpgradeChoice[],
    packageJsonPath: string,
    type: DependencyType
  ): Promise<void> {
    // Validate that package.json exists
    if (!existsSync(packageJsonPath)) {
      this.log(
        chalk.yellow(`⚠️  Skipping ${type} in ${packageJsonPath} - package.json file not found`)
      )
      return
    }

    const packageDir = packageJsonPath.replace('/package.json', '')
    // The spinner animates on stdout; skip it in quiet mode so the --json document stays clean.
    const spinner = this.quiet
      ? null
      : createSpinner(`Upgrading ${type} in ${packageDir}...`).start()

    try {
      // Read the current package.json — keep the raw text so we can round-trip its formatting
      const rawContent = readFileSync(packageJsonPath, 'utf-8')
      const packageJson = readPackageJson(packageJsonPath)

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

      // Write back the modified package.json, preserving the original indentation and
      // trailing-newline style. Skip the write entirely when nothing actually changed.
      if (modified) {
        const format = detectJsonFormat(rawContent)
        const nextContent =
          JSON.stringify(packageJson, null, format.indent) + (format.trailingNewline ? '\n' : '')
        if (nextContent !== rawContent) {
          writeFileSync(packageJsonPath, nextContent)
        }
      }

      if (spinner) spinner.success({ text: `Upgraded ${choices.length} ${type} in ${packageDir}` })
      else this.log(chalk.green(`✔ Upgraded ${choices.length} ${type} in ${packageDir}`))

      // Show which packages were upgraded
      choices.forEach((choice) => {
        const upgradeTypeColor = choice.upgradeType === 'range' ? chalk.yellow : chalk.red
        this.log(
          `  ${chalk.green('✓')} ${chalk.cyan(choice.name)} → ${upgradeTypeColor(choice.targetVersion)}`
        )
      })
    } catch (error) {
      if (spinner) spinner.error({ text: `Failed to upgrade ${type} in ${packageDir}` })
      else this.log(chalk.red(`✖ Failed to upgrade ${type} in ${packageDir}`))
      console.error(chalk.red(`Error: ${error}`))
      throw error
    }
  }
}
