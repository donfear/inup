#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { UpgradeRunner } from './index'
import { checkForUpdateAsync } from './services'
import { loadProjectConfig } from './config'
import { PackageManager } from './types'
import { enableDebugLogging } from './utils'

const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'))

const program = new Command()

program
  .name('inup')
  .description(
    'Interactive upgrade tool for package managers. Auto-detects and works with npm, yarn, pnpm, and bun.'
  )
  .version(packageJson.version)
  .option('-d, --dir <directory>', 'specify directory to run in', process.cwd())
  .option('-e, --exclude <patterns>', 'exclude paths matching regex patterns (comma-separated)', '')
  .option(
    '-i, --ignore <packages>',
    'ignore packages (comma-separated, supports glob patterns like @babel/*)'
  )
  .option('--max-depth <number>', 'maximum directory depth for package.json discovery', '10')
  .option('--package-manager <name>', 'manually specify package manager (npm, yarn, pnpm, bun)')
  .option('--debug', 'write verbose debug log to /tmp/inup-debug-YYYY-MM-DD.log')
  .action(async (options) => {
    const cwd = resolve(options.dir)

    if (options.debug || process.env.INUP_DEBUG === '1') {
      enableDebugLogging()
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
    const updateCheckPromise = checkForUpdateAsync('inup', packageJson.version)

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
      console.log('')
      console.log(chalk.yellow('┌' + '─'.repeat(78) + '┐'))
      console.log(
        chalk.yellow('│') +
          ' ' +
          chalk.bold.yellow('Update available! ') +
          chalk.gray(`${updateCheck.currentVersion}`) +
          ' → ' +
          chalk.green(`${updateCheck.latestVersion}`) +
          ' '.repeat(
            78 - 19 - updateCheck.currentVersion.length - 3 - updateCheck.latestVersion.length - 1
          ) +
          chalk.yellow('│')
      )
      console.log(
        chalk.yellow('│') +
          ' ' +
          chalk.gray('Run: ') +
          chalk.cyan(updateCheck.updateCommand) +
          ' '.repeat(78 - 6 - updateCheck.updateCommand.length - 1) +
          chalk.yellow('│')
      )
      console.log(chalk.yellow('└' + '─'.repeat(78) + '┘'))
      console.log('')
    }
  })

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

program.parse()
