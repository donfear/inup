#!/usr/bin/env node

import { resolve } from 'node:path'
import chalk from 'chalk'
import { Command } from 'commander'
import { HeadlessRunner } from './features/headless'
import { UpgradeRunner } from './index'
import { loadProjectConfig, PACKAGE_NAME, PACKAGE_VERSION } from './shared/config'
import { enableDebugLogging } from './shared/debug-logger'
import { getGitWorkingTreeState } from './shared/git'
import { loadInupLocalEnv } from './shared/local-env'
import { checkForUpdateAsync } from './shared/registry/version-checker'
import { applyColorSetting, TerminalInput } from './shared/terminal'
import type { PackageManager, UpgradeOptions } from './shared/types'

// Load developer-only toggles from <inup-repo>/.env.local before anything reads
// env. Best-effort, gitignored, never overrides real env. Lets perf/debug be
// "set once" across every project without shell config.
loadInupLocalEnv()

const program = new Command()

export interface CliOptions {
  dir: string
  exclude: string
  ignore: string
  maxDepth: string
  packageManager?: string
  debug?: boolean
  color?: boolean
  saveExact?: boolean
  json?: boolean
  check?: boolean
  apply?: boolean
  target?: string
}

export async function runCli(options: CliOptions): Promise<void> {
  // Resolve colored-output intent before anything renders.
  applyColorSetting(options.color)

  const cwd = resolve(options.dir)

  if (options.debug || process.env.INUP_DEBUG === '1') {
    enableDebugLogging()
  }

  // Headless when piped, in CI, or when a non-interactive flag is set. The TUI only renders in
  // interactive mode; everything else routes through the headless path (read-only, unless --apply).
  const interactive =
    !!process.stdout.isTTY && !process.env.CI && !options.json && !options.check && !options.apply

  // Validate --target early so a typo fails fast instead of silently defaulting.
  if (options.target && !['minor', 'patch', 'latest'].includes(options.target)) {
    console.error(chalk.red(`Invalid target: ${options.target}`))
    console.error(chalk.yellow('Valid options: minor, patch, latest'))
    process.exit(1)
  }

  // The dirty-tree prompt would hang without a TTY; headless is read-only anyway, so skip it.
  if (interactive) {
    const gitState = getGitWorkingTreeState(cwd)
    if (gitState.isRepo && gitState.isDirty) {
      const shouldProceed = await TerminalInput.promptForImmediateConfirmation(
        `${chalk.yellow('Warning:')} dirty working tree. Proceed anyway? ${chalk.dim('[y/N]')} `,
        false
      )
      if (!shouldProceed) {
        console.log(chalk.yellow('Upgrade cancelled.'))
        return
      }
    }
  }

  // Load project config from .inuprc
  const projectConfig = loadProjectConfig(cwd)

  // Merge CLI exclude patterns with config
  const cliExcludePatterns = options.exclude
    ? options.exclude
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean)
    : []
  const excludePatterns = [...cliExcludePatterns, ...(projectConfig.exclude || [])]

  // Merge CLI ignore patterns with config (CLI takes precedence / adds to config)
  const cliIgnorePatterns = options.ignore
    ? options.ignore
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean)
    : []
  const ignorePackages = [...new Set([...cliIgnorePatterns, ...(projectConfig.ignore || [])])]

  const maxDepth = Number.parseInt(options.maxDepth, 10)
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    console.error(chalk.red(`Invalid max depth: ${options.maxDepth}`))
    console.error(chalk.yellow('Expected a non-negative integer, for example: --max-depth 10'))
    process.exit(1)
  }

  // Check for updates in the background (non-blocking). Interactive only — keeps headless stdout
  // clean and avoids a lingering fetch handle in CI.
  const updateCheckPromise = interactive
    ? checkForUpdateAsync(PACKAGE_NAME, PACKAGE_VERSION)
    : undefined

  // Validate package manager if provided
  let packageManager: PackageManager | undefined
  if (options.packageManager) {
    const validPMs = ['npm', 'yarn', 'pnpm', 'bun']
    if (!validPMs.includes(options.packageManager)) {
      console.error(chalk.red(`Invalid package manager: ${options.packageManager}`))
      console.error(chalk.yellow(`Valid options: ${validPMs.join(', ')}`))
      process.exit(1)
    }
    packageManager = options.packageManager as PackageManager
  }

  const runnerOptions: UpgradeOptions = {
    cwd,
    excludePatterns,
    scanDirs: projectConfig.scanDirs,
    maxDepth,
    ignorePackages,
    packageManager,
    showPeerDependencyVulnerabilities: projectConfig.showPeerDependencyVulnerabilities ?? false,
    showOptionalDependencyVulnerabilities:
      projectConfig.showOptionalDependencyVulnerabilities ?? false,
    debug: options.debug || process.env.INUP_DEBUG === '1',
    saveExact: options.saveExact ?? false,
    // Adaptive concurrency defaults ON; it's an internal/dev toggle with no public
    // flag. Set INUP_ADAPTIVE=0 to disable (e.g. for A/B perf comparisons).
    adaptive: process.env.INUP_ADAPTIVE !== '0',
  }

  // Non-interactive (piped / CI / --json / --check) routes to the read-only headless feature;
  // only the interactive path builds the full TUI runner.
  if (!interactive) {
    await new HeadlessRunner(runnerOptions).run({
      json: options.json,
      check: options.check,
      apply: options.apply,
      target: (options.target as 'minor' | 'patch' | 'latest') || 'minor',
    })
    return
  }

  await new UpgradeRunner(runnerOptions).run()

  // After the main flow completes, check if there's an update available
  const updateCheck = await updateCheckPromise
  if (updateCheck?.isOutdated) {
    const columns =
      process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80
    const innerWidth = Math.max(40, Math.min(columns, 100) - 2) // chars between the │ borders
    const border = chalk.yellow
    const padTo = (visibleLength: number) => ' '.repeat(Math.max(0, innerWidth - visibleLength))

    const line1Plain = ` Update available! ${updateCheck.currentVersion} → ${updateCheck.latestVersion}`
    const line1 =
      ' ' +
      chalk.bold.yellow('Update available! ') +
      chalk.gray(updateCheck.currentVersion) +
      ' → ' +
      chalk.green(updateCheck.latestVersion)

    const line2Plain = ` Run: ${updateCheck.updateCommand}`
    const line2 = ` ${chalk.gray('Run: ')}${chalk.cyan(updateCheck.updateCommand)}`

    console.log('')
    console.log(border(`┌${'─'.repeat(innerWidth)}┐`))
    console.log(border('│') + line1 + padTo(line1Plain.length) + border('│'))
    console.log(border('│') + line2 + padTo(line2Plain.length) + border('│'))
    console.log(border(`└${'─'.repeat(innerWidth)}┘`))
    console.log('')
  }
}

program
  .name(PACKAGE_NAME)
  .description(
    'Interactive upgrade tool for package managers. Auto-detects and works with npm, yarn, pnpm, and bun.'
  )
  .version(PACKAGE_VERSION)
  .option('-d, --dir <directory>', 'specify directory to run in', process.cwd())
  .option('-e, --exclude <patterns>', 'exclude paths matching regex patterns (comma-separated)', '')
  .option(
    '-i, --ignore <packages>',
    'ignore packages (comma-separated, supports glob patterns like @babel/*)'
  )
  .option('--max-depth <number>', 'maximum directory depth for package.json discovery', '10')
  .option('--package-manager <name>', 'manually specify package manager (npm, yarn, pnpm, bun)')
  .option('--debug', 'write verbose debug log to /tmp/inup-debug-YYYY-MM-DD.log')
  .option('--no-color', 'disable colored output (also respects NO_COLOR / FORCE_COLOR)')
  .option('--save-exact', 'write exact versions instead of preserving the range prefix (^/~)')
  .option('--json', 'print a machine-readable JSON report and exit (non-interactive, read-only)')
  .option('-c, --check', 'exit non-zero if updates exist, without writing (for CI; read-only)')
  .option(
    '--apply',
    'non-interactively write upgrades to package.json and run install (honors .inuprc ignore/exclude)'
  )
  .option(
    '--target <level>',
    'with --apply: how far to bump — minor (in-range) | patch (same major.minor only) | latest (default: minor)',
    'minor'
  )
  .action(runCli)

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Uncaught Exception:'), error.message)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('Unhandled Rejection:'), reason)
  process.exit(1)
})

// Handle Ctrl+C gracefully
let sigintReceived = false
process.on('SIGINT', () => {
  if (sigintReceived) {
    // Force exit on second Ctrl+C
    console.log(chalk.red('\n\nForce exiting...'))
    process.exit(1)
  } else {
    sigintReceived = true
    console.log(chalk.yellow('\n\nOperation cancelled by user. Press Ctrl+C again to force exit.'))
    process.exit(0)
  }
})

// Also handle SIGTERM
process.on('SIGTERM', () => {
  console.log(chalk.yellow('\n\nOperation cancelled.'))
  process.exit(0)
})

if (require.main === module) {
  program.parse()
}
