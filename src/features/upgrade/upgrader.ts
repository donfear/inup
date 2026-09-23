import { type StdioOptions, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import chalk from 'chalk'
import { createSpinner } from 'nanospinner'
import { executeCommand } from '../../shared/exec'
import {
  detectJsonFormat,
  findWorkspaceRoot,
  stringifyWithFormat,
  writeFileAtomic,
} from '../../shared/fs'
import { writeCatalogUpdates } from '../../shared/pnpm-catalogs'
import type {
  DependencyType,
  PackageJson,
  PackageManagerInfo,
  PackageUpgradeChoice,
} from '../../shared/types'

/** A choice known to target a pnpm catalog entry (its `catalog` is always set). */
type CatalogUpgradeChoice = PackageUpgradeChoice & { catalog: string }

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

  public async upgradePackages(choices: PackageUpgradeChoice[]): Promise<void> {
    if (choices.length === 0) {
      this.log(chalk.yellow('No packages to upgrade.'))
      return
    }

    // Catalog entries live in pnpm-workspace.yaml, not a package.json — they
    // take the YAML write path below. The type predicate narrows the catalog
    // group so downstream code sees `catalog` as a required string.
    const catalogChoices = choices.filter(
      (choice): choice is CatalogUpgradeChoice => choice.catalog !== undefined
    )
    const fileChoices = choices.filter((choice) => choice.catalog === undefined)

    // Group choices by package.json path, then dependency type
    for (const [packageJsonPath, byType] of this.groupChoicesByFileAndType(fileChoices)) {
      // groupChoicesByFileAndType only creates a group once it has a member,
      // so choiceList is always non-empty here.
      for (const [type, choiceList] of byType) {
        this.log(`Processing ${type} in ${packageJsonPath}`)
        await this.upgradeChoiceGroup(choiceList, packageJsonPath, type)
      }
    }

    if (catalogChoices.length > 0) {
      await this.upgradeCatalogChoices(catalogChoices)
    }

    // Install before claiming success: if it fails, the lockfile no longer matches the manifests.
    await this.runInstall(choices)

    // Count unique packages upgraded
    const uniquePackages = new Set(choices.map((c) => c.name))
    this.log(chalk.green(`\n✅ Successfully upgraded ${uniquePackages.size} package(s)!`))
  }

  private async runInstall(choices: PackageUpgradeChoice[]): Promise<void> {
    // We just rewrote package.json, so the install must be allowed to regenerate the lockfile.
    // pnpm/yarn default to frozen/immutable installs under CI; writeInstallCommand opts out.
    const installCommand =
      this.packageManager.writeInstallCommand ?? this.packageManager.installCommand

    // Keep going after a failure so every other project still gets its lockfile updated, then
    // fail once, naming each directory that still needs an install.
    const failures: string[] = []
    for (const installDir of this.findInstallDirs(choices)) {
      const failure = this.installIn(installDir, installCommand)
      if (failure) failures.push(`  ${installDir} (${failure})`)
    }

    if (failures.length > 0) {
      throw new Error(
        `Upgrades were written, but the install did not finish, so the lockfile is out of date. Run \`${installCommand}\` in:\n${failures.join('\n')}`
      )
    }
  }

  /**
   * One install per project the selection touched: the workspace root for workspace members,
   * else the manifest's own directory. A selection can span independent projects (separate
   * lockfiles, e.g. examples/ scanned from the repo root), and each needs its own install.
   * Manifests skipped as missing are left out — nothing was written there. Sorted so the order
   * doesn't depend on selection order.
   */
  private findInstallDirs(choices: PackageUpgradeChoice[]): string[] {
    const installDirs = new Set<string>()
    for (const manifestPath of new Set(choices.map((c) => c.packageJsonPath))) {
      if (!existsSync(manifestPath)) continue
      const manifestDir = dirname(manifestPath)
      installDirs.add(findWorkspaceRoot(manifestDir, this.packageManager.name) ?? manifestDir)
    }
    return [...installDirs].sort()
  }

  /** Run the install in one directory. Returns why it failed, or null when it succeeded. */
  private installIn(installDir: string, installCommand: string): string | null {
    // Check if package manager is installed
    try {
      executeCommand(`${this.packageManager.name} --version`, installDir)
    } catch {
      return `${this.packageManager.displayName} is not installed`
    }

    this.log(chalk.cyan(`\n📦 Running ${installCommand} in ${installDir}...\n`))

    // In quiet mode, send the install child's stdout to *our* stderr (fd 2). The child uses
    // inherited fds, so its progress output bypasses any JS shim — redirecting at spawn time is
    // the only reliable way to keep stdout reserved for the --json document. stderr stays inherited.
    const stdio: StdioOptions = this.quiet ? ['inherit', 2, 'inherit'] : 'inherit'

    const result = spawnSync(installCommand, {
      cwd: installDir,
      stdio,
      shell: true,
    })

    if (result.error) return `${installCommand} could not start: ${result.error.message}`
    if (result.signal) return `${installCommand} terminated by signal ${result.signal}`
    if (result.status !== 0) return `${installCommand} exited with code ${result.status}`
    return null
  }

  /**
   * Apply catalog upgrades by rewriting the referenced ranges inside
   * pnpm-workspace.yaml (comment- and format-preserving). One write per file.
   */
  private async upgradeCatalogChoices(choices: CatalogUpgradeChoice[]): Promise<void> {
    const choicesByFile = new Map<string, CatalogUpgradeChoice[]>()
    choices.forEach((choice) => {
      const group = choicesByFile.get(choice.packageJsonPath) ?? []
      group.push(choice)
      choicesByFile.set(choice.packageJsonPath, group)
    })

    for (const [workspaceFilePath, fileChoices] of choicesByFile) {
      if (!existsSync(workspaceFilePath)) {
        this.log(
          chalk.yellow(`⚠️  Skipping catalog entries in ${workspaceFilePath} - file not found`)
        )
        continue
      }

      this.log(`Processing catalog entries in ${workspaceFilePath}`)
      const spinner = this.quiet
        ? null
        : createSpinner(`Upgrading catalog entries in ${workspaceFilePath}...`).start()

      try {
        writeCatalogUpdates(
          workspaceFilePath,
          fileChoices.map((choice) => ({
            catalog: choice.catalog,
            name: choice.name,
            range: choice.targetVersion,
          }))
        )

        const message = `Upgraded ${fileChoices.length} catalog entr${
          fileChoices.length === 1 ? 'y' : 'ies'
        } in ${workspaceFilePath}`
        if (spinner) spinner.success({ text: message })
        else this.log(chalk.green(`✔ ${message}`))

        fileChoices.forEach((choice) => {
          const upgradeTypeColor = choice.upgradeType === 'range' ? chalk.yellow : chalk.red
          const catalogLabel =
            choice.catalog === 'default' ? 'catalog' : `catalog:${choice.catalog}`
          this.log(
            `  ${chalk.green('✓')} ${chalk.cyan(choice.name)} (${catalogLabel}) → ${upgradeTypeColor(choice.targetVersion)}`
          )
        })
      } catch (error) {
        if (spinner)
          spinner.error({ text: `Failed to upgrade catalog entries in ${workspaceFilePath}` })
        else this.log(chalk.red(`✖ Failed to upgrade catalog entries in ${workspaceFilePath}`))
        console.error(chalk.red(`Error: ${error}`))
        throw error
      }
    }
  }

  private groupChoicesByFileAndType(
    choices: PackageUpgradeChoice[]
  ): Map<string, Map<DependencyType, PackageUpgradeChoice[]>> {
    const groups = new Map<string, Map<DependencyType, PackageUpgradeChoice[]>>()

    choices.forEach((choice) => {
      let byType = groups.get(choice.packageJsonPath)
      if (!byType) {
        byType = new Map()
        groups.set(choice.packageJsonPath, byType)
      }
      const group = byType.get(choice.dependencyType)
      if (group) group.push(choice)
      else byType.set(choice.dependencyType, [choice])
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

    // dirname, not string replace: Windows paths use backslashes, so a '/package.json'
    // replace would silently no-op there and log the full file path instead of the dir.
    const packageDir = dirname(packageJsonPath)
    // The spinner animates on stdout; skip it in quiet mode so the --json document stays clean.
    const spinner = this.quiet
      ? null
      : createSpinner(`Upgrading ${type} in ${packageDir}...`).start()

    try {
      // Read the current package.json — keep the raw text so we can round-trip its formatting
      const rawContent = readFileSync(packageJsonPath, 'utf-8')
      const packageJson = JSON.parse(rawContent) as PackageJson

      // Range and latest upgrades write the same way; 'none' choices leave the entry alone.
      const upgrades = choices.filter((c) => c.upgradeType !== 'none')
      if (upgrades.length > 0) {
        const section = packageJson[type] ?? {}
        packageJson[type] = section
        upgrades.forEach((choice) => {
          section[choice.name] = choice.targetVersion
        })
      }

      // Write back the modified package.json, preserving the original indentation,
      // line-ending, and trailing-newline style. Skip the write entirely when nothing
      // actually changed. Atomic, so a failed write can't leave a truncated package.json.
      const format = detectJsonFormat(rawContent)
      const nextContent = stringifyWithFormat(packageJson, format)
      if (nextContent !== rawContent) {
        writeFileAtomic(packageJsonPath, nextContent)
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
