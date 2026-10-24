import { type StdioOptions, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import chalk from 'chalk'
import { findWorkspaceRoot } from '../../shared/fs'
import type { PackageManagerInfo, PackageUpgradeChoice } from '../../shared/types'
import type { PackageUpgrader } from './upgrader'

export interface VerifyResult {
  /** Packages upgraded with the verify command still passing. */
  kept: string[]
  /** Packages whose upgrade failed the verify command (or its install), put back as they were. */
  reverted: string[]
}

/** The files an upgrade can change, and their contents before it (null: did not exist). */
type Snapshot = Map<string, string | null>

/**
 * `--apply --verify <command>`: upgrade, then run the command (usually the tests). When it fails,
 * put everything back and retry one package at a time, keeping each upgrade the command still
 * passes with and reverting the rest. Refuses to start if the command fails before upgrading:
 * it couldn't tell an upgrade that breaks it from a check that was already broken.
 */
export class VerifiedUpgrade {
  private readonly log: (message: string) => void
  private readonly stdio: StdioOptions

  constructor(
    private readonly upgrader: PackageUpgrader,
    private readonly packageManager: PackageManagerInfo,
    private readonly command: string,
    private readonly cwd: string,
    { quiet = false }: { quiet?: boolean } = {}
  ) {
    this.log = quiet ? (message) => console.error(message) : (message) => console.log(message)
    // As for the install: in quiet mode the command's stdout goes to stderr, keeping stdout for --json.
    this.stdio = quiet ? ['inherit', 2, 'inherit'] : 'inherit'
  }

  async run(choices: PackageUpgradeChoice[]): Promise<VerifyResult> {
    if (!this.passes('before upgrading')) {
      throw new Error(
        `\`${this.command}\` fails before upgrading anything, so it can't tell which upgrade breaks it. Make it pass first.`
      )
    }

    const names = [...new Set(choices.map((choice) => choice.name))]
    if (await this.tryUpgrade(choices, 'with every upgrade')) {
      return this.report({ kept: names, reverted: [] })
    }

    this.log(chalk.yellow('\nRetrying one package at a time to find the upgrades that break it.'))
    const result: VerifyResult = { kept: [], reverted: [] }
    for (const name of names) {
      const ok = await this.tryUpgrade(
        choices.filter((choice) => choice.name === name),
        `with ${name} upgraded`
      )
      ;(ok ? result.kept : result.reverted).push(name)
    }
    return this.report(result)
  }

  /** Apply the choices and run the command; on failure, put the files and install back. */
  private async tryUpgrade(choices: PackageUpgradeChoice[], label: string): Promise<boolean> {
    const before = this.snapshot(choices)
    try {
      await this.upgrader.upgradePackages(choices)
      if (this.passes(label)) return true
    } catch (error) {
      this.log(chalk.yellow(`Upgrade failed ${label}: ${(error as Error).message}`))
    }
    this.restore(before)
    await this.upgrader.reinstall(choices)
    return false
  }

  private passes(label: string): boolean {
    this.log(chalk.cyan(`\n🧪 Running ${this.command} ${label}...\n`))
    const result = spawnSync(this.command, { cwd: this.cwd, stdio: this.stdio, shell: true })
    return result.status === 0
  }

  /** Every manifest the choices write, and the lockfile of each project they install in. */
  private snapshot(choices: PackageUpgradeChoice[]): Snapshot {
    const files = new Set<string>()
    for (const { packageJsonPath } of choices) {
      files.add(packageJsonPath)
      const dir = dirname(packageJsonPath)
      const root = findWorkspaceRoot(dir, this.packageManager.name) ?? dir
      files.add(join(root, this.packageManager.lockFile))
    }
    return new Map(
      [...files].map((file) => [file, existsSync(file) ? readFileSync(file, 'utf-8') : null])
    )
  }

  private restore(snapshot: Snapshot): void {
    for (const [file, content] of snapshot) {
      if (content === null) rmSync(file, { force: true })
      else writeFileSync(file, content)
    }
  }

  private report(result: VerifyResult): VerifyResult {
    this.log(
      chalk.green(
        `\n✅ Kept ${result.kept.length} upgrade(s) that pass \`${this.command}\`${
          result.kept.length > 0 ? `: ${result.kept.join(', ')}` : ''
        }`
      )
    )
    if (result.reverted.length > 0) {
      this.log(
        chalk.yellow(
          `↩️  Reverted ${result.reverted.length} that fail it: ${result.reverted.join(', ')}`
        )
      )
    }
    return result
  }
}
