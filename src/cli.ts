#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import { resolve } from 'path'
import { UpgradeRunner } from './index'
import { checkForUpdateAsync } from './services'
import { loadProjectConfig, PACKAGE_NAME, PACKAGE_VERSION } from './config'
import { PackageManager } from './types'
import { enableDebugLogging } from './utils'
import { getGitWorkingTreeState } from './utils/git'
import { TerminalInput } from './ui'

const program = new Command()

export interface CliOptions {
  dir: string
  exclude: string
  ignore: string
  maxDepth: string
  packageManager?: string
  debug?: boolean
}

export async function runCli(options: CliOptions): Promise<void> {
  const cwd = resolve(options.dir)

  if (options.debug || process.env.INUP_DEBUG === '1') {
    enableDebugLogging()
  }

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

  // Check for updates in the background (non-blocking)
  const updateCheckPromise = checkForUpdateAsync(PACKAGE_NAME, PACKAGE_VERSION)

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

  const upgrader = new UpgradeRunner({
    cwd,
    excludePatterns,
    maxDepth,
    ignorePackages,
    packageManager,
    showPeerDependencyVulnerabilities:
      projectConfig.showPeerDependencyVulnerabilities ?? false,
    showOptionalDependencyVulnerabilities:
      projectConfig.showOptionalDependencyVulnerabilities ?? false,
    debug: options.debug || process.env.INUP_DEBUG === '1',
  })
  await upgrader.run()

  // After the main flow completes, check if there's an update available
  const updateCheck = await updateCheckPromise
  if (updateCheck?.isOutdated) {
    const columns = process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80
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
    const line2 = ' ' + chalk.gray('Run: ') + chalk.cyan(updateCheck.updateCommand)

    console.log('')
    console.log(border('┌' + '─'.repeat(innerWidth) + '┐'))
    console.log(border('│') + line1 + padTo(line1Plain.length) + border('│'))
    console.log(border('│') + line2 + padTo(line2Plain.length) + border('│'))
    console.log(border('└' + '─'.repeat(innerWidth) + '┘'))
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
