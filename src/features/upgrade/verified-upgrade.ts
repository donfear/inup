import { type StdioOptions, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import chalk from 'chalk'
import type { PackageUpgradeChoice } from '../../shared/types'
import type { PackageUpgrader } from './upgrader'

export interface VerifyOptions {
  /** The command the upgrades must keep passing, usually the tests (`npm test`). */
  command: string
  /** Where the command runs. */
  cwd: string
  /** Log to stderr and send the command's stdout there too, keeping stdout for `--json`. */
  quiet?: boolean
}

export interface VerifyResult {
  /** Packages upgraded with the command still passing. */
  kept: string[]
  /** Packages whose upgrade failed the command (or its install), put back as they were. */
  reverted: string[]
}

/** Each file an upgrade can write, with its contents before it (null: it did not exist). */
type Snapshot = Map<string, string | null>

/**
 * `--verify <command>`, or `verify` in .inuprc: upgrade, then run the command. When it fails,
 * put everything back and retry one package at a time, keeping each upgrade the command passes
 * with and reverting the rest. Refuses to start when the command already fails, because it
 * couldn't tell an upgrade that breaks it from a check that was broken before.
 */
export class VerifiedUpgrade {
  private readonly command: string
  private readonly cwd: string
  private readonly stdio: StdioOptions
  private readonly log: (message: string) => void

  constructor(
    private readonly upgrader: PackageUpgrader,
    { command, cwd, quiet = false }: VerifyOptions
  ) {
    this.command = command
    this.cwd = cwd
    // As for the install: in quiet mode the command's stdout goes to stderr.
    this.stdio = quiet ? ['inherit', 2, 'inherit'] : 'inherit'
    this.log = quiet ? (message) => console.error(message) : (message) => console.log(message)
  }

  async run(choices: PackageUpgradeChoice[]): Promise<VerifyResult> {
    if (!this.passes('before upgrading')) {
      throw new Error(
        `\`${this.command}\` fails before upgrading anything, so inup can't tell which upgrade breaks it. Make it pass first, or skip it with --no-verify.`
      )
    }

    const byName = groupByName(choices)
    if (await this.tryUpgrade(choices, 'with every upgrade')) {
      return this.report({ kept: [...byName.keys()], reverted: [] })
    }
    // With a single package, the round that just failed was already its own.
    if (byName.size === 1) {
      return this.report({ kept: [], reverted: [...byName.keys()] })
    }

    this.log(chalk.yellow('\nRetrying one package at a time to find the upgrades that break it.'))
    const result: VerifyResult = { kept: [], reverted: [] }
    for (const [name, group] of byName) {
      if (await this.tryUpgrade(group, `with ${name} upgraded`)) result.kept.push(name)
      else result.reverted.push(name)
    }
    return this.report(result)
  }

  /** Upgrade and run the command. When either fails, put the files back and install again. */
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

  private snapshot(choices: PackageUpgradeChoice[]): Snapshot {
    return new Map(
      this.upgrader
        .filesWrittenBy(choices)
        .map((file) => [file, existsSync(file) ? readFileSync(file, 'utf-8') : null])
    )
  }

  private restore(snapshot: Snapshot): void {
    for (const [file, content] of snapshot) {
      if (content === null) rmSync(file, { force: true })
      else writeFileSync(file, content)
    }
  }

  private report(result: VerifyResult): VerifyResult {
    const { kept, reverted } = result
    const names = (list: string[]) => (list.length > 0 ? `: ${list.join(', ')}` : '')
    this.log(
      chalk.green(`\n✅ Kept ${kept.length} upgrade(s) that pass \`${this.command}\`${names(kept)}`)
    )
    if (reverted.length > 0) {
      this.log(chalk.yellow(`↩️  Reverted ${reverted.length} that fail it${names(reverted)}`))
    }
    return result
  }
}

/** The choices per package: one package is kept or reverted in every manifest that declares it. */
function groupByName(choices: PackageUpgradeChoice[]): Map<string, PackageUpgradeChoice[]> {
  const groups = new Map<string, PackageUpgradeChoice[]>()
  for (const choice of choices) {
    const group = groups.get(choice.name)
    if (group) group.push(choice)
    else groups.set(choice.name, [choice])
  }
  return groups
}
