#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PnpmUpgradeInteractive } from './index'
import { checkForUpdateAsync } from './services'

const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'))

const program = new Command()

program
  .name('inup')
  .description('Interactive upgrade tool for package managers')
  .version(packageJson.version)
  .option('-d, --dir <directory>', 'specify directory to run in', process.cwd())
  .option('-e, --exclude <patterns>', 'exclude paths matching regex patterns (comma-separated)', '')
  .option('-p, --peer', 'include peer dependencies in upgrade process')
  .option('-o, --optional', 'include optional dependencies in upgrade process')
  .action(async (options) => {
    console.log(chalk.bold.blue(`🚀 inup\n`))

    // Check for updates in the background (non-blocking)
    const updateCheckPromise = checkForUpdateAsync('inup', packageJson.version)

    const excludePatterns = options.exclude
      ? options.exclude
          .split(',')
          .map((p: string) => p.trim())
          .filter(Boolean)
      : []

    // Commander.js: boolean flags are undefined if not provided, true if provided
    // Both flags default to false (opt-in)
    const includePeerDeps = options.peer === true
    const includeOptionalDeps = options.optional === true

    const upgrader = new PnpmUpgradeInteractive({
      cwd: options.dir,
      excludePatterns,
      includePeerDeps,
      includeOptionalDeps,
    })
    await upgrader.run()

    // After the main flow completes, check if there's an update available
    const updateCheck = await updateCheckPromise
    if (updateCheck?.isOutdated) {
      console.log('')
      console.log(
        chalk.yellow('┌' + '─'.repeat(78) + '┐')
      )
      console.log(
        chalk.yellow('│') +
          ' ' +
          chalk.bold.yellow('Update available! ') +
          chalk.gray(`${updateCheck.currentVersion}`) +
          ' → ' +
          chalk.green(`${updateCheck.latestVersion}`) +
          ' '.repeat(78 - 19 - updateCheck.currentVersion.length - 3 - updateCheck.latestVersion.length - 1) +
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
      console.log(
        chalk.yellow('└' + '─'.repeat(78) + '┘')
      )
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
