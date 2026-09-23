#!/usr/bin/env node

import { writeFileSync } from 'node:fs'
import { enableCompileCache } from 'node:module'
import { join, resolve } from 'node:path'
import chalk from 'chalk'
import { Command, Option } from 'commander'
import type { ApplyTarget } from './features/headless'
import {
  buildConfigTemplate,
  findExistingConfigFile,
  INIT_CONFIG_FILENAME,
  isValidConcurrency,
  isValidMinimumReleaseAge,
  loadProjectConfig,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  POOL_CONNECTIONS,
} from './shared/config'
import { enableDebugLogging } from './shared/debug-logger'
import { getGitWorkingTreeState } from './shared/git'
import { PACKAGE_MANAGER_NAMES } from './shared/package-manager'
import { checkForUpdateAsync } from './shared/registry/version-checker'
import { applyColorSetting, isInteractiveTerminal, TerminalInput } from './shared/terminal'
import type { PackageManager, UpgradeOptions } from './shared/types'

// Reuse V8's compiled bytecode across invocations (Node ≥ 22.1; a no-op where
// unsupported or disabled). Measured ~25 ms off every start.
if (typeof enableCompileCache === 'function') {
  try {
    enableCompileCache()
  } catch {
    /* best-effort */
  }
}

export const program = new Command()

export interface CliOptions {
  dir: string
  exclude: string
  ignore: string
  maxDepth: string
  packageManager?: PackageManager
  init?: boolean
  debug?: boolean
  color?: boolean
  saveExact?: boolean
  json?: boolean
  check?: boolean
  apply?: boolean
  target?: ApplyTarget
  concurrency?: string
  native?: boolean
  minimumReleaseAge?: string
}

/** A comma-separated flag value as a list, trimmed and without empty entries. */
function splitList(value: string | undefined): string[] {
  return value
    ? value
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
    : []
}

/**
 * `--init`: write a fully commented starter config to <cwd>/.inuprc.
 * When a config file already exists in that directory, ask before overwriting;
 * without a terminal on both ends there is no way to confirm, so refuse instead of clobbering.
 */
async function runInit(cwd: string): Promise<void> {
  const existing = findExistingConfigFile(cwd)
  const targetPath = join(cwd, INIT_CONFIG_FILENAME)

  if (existing) {
    if (!isInteractiveTerminal()) {
      console.error(chalk.red(`Config already exists: ${existing}`))
      console.error(chalk.yellow('Refusing to overwrite without confirmation. Delete it first,'))
      console.error(chalk.yellow('or run `inup --init` in an interactive terminal to confirm.'))
      process.exit(2)
    }
    const shouldOverwrite = await TerminalInput.promptForImmediateConfirmation(
      `${chalk.yellow('Config already exists:')} ${existing}. Overwrite with a fresh template? ${chalk.dim('[y/N]')} `,
      false
    )
    if (!shouldOverwrite) {
      console.log(chalk.yellow('Kept the existing config.'))
      return
    }
  }

  writeFileSync(targetPath, buildConfigTemplate(), 'utf-8')
  console.log(`${chalk.green('Created')} ${targetPath}`)
  if (existing && existing !== targetPath) {
    // e.g. inup.config.json was found but we always write .inuprc, which is
    // first in the loader's lookup order — the old file is now shadowed.
    console.log(
      chalk.yellow(`Note: ${existing} still exists but ${INIT_CONFIG_FILENAME} takes precedence.`)
    )
  }
  console.log(chalk.dim('Every field is documented inline; comments are allowed in this file.'))
}

/**
 * The project config, or exit 2 (error) when the nearest config file can't be parsed. Never
 * falls back to defaults or a parent config: the broken file may be the one turning the
 * cooldown on, and running without it would look exactly like a normal run.
 */
function loadProjectConfigOrExit(cwd: string) {
  try {
    return loadProjectConfig(cwd)
  } catch (error) {
    console.error(chalk.red((error as Error).message))
    process.exit(2)
  }
}

export async function runCli(options: CliOptions): Promise<void> {
  // Resolve colored-output intent before anything renders.
  applyColorSetting(options.color)

  const cwd = resolve(options.dir)

  if (options.init) {
    await runInit(cwd)
    return
  }

  if (options.debug) {
    enableDebugLogging()
  }

  // Headless when stdin or stdout is not a terminal, in CI, or when a non-interactive flag is set.
  // The TUI only renders in interactive mode; everything else routes through the headless path
  // (read-only, unless --apply).
  const interactive = isInteractiveTerminal() && !options.json && !options.check && !options.apply

  // Validate --minimum-release-age the same way. Undefined means "defer to .inuprc"; an
  // explicit 0 means "disable the configured cooldown for this run", so presence is what
  // counts, not truthiness. Number() rather than parseInt: parseInt('7.5') is 7, and a
  // security control must reject input it cannot honor instead of quietly rounding it.
  let cliMinimumReleaseAge: number | undefined
  if (options.minimumReleaseAge !== undefined) {
    cliMinimumReleaseAge = Number(options.minimumReleaseAge)
    if (
      options.minimumReleaseAge.trim() === '' ||
      !isValidMinimumReleaseAge(cliMinimumReleaseAge)
    ) {
      console.error(chalk.red(`Invalid minimum release age: ${options.minimumReleaseAge}`))
      console.error(
        chalk.yellow('Expected a non-negative number of minutes, e.g. --minimum-release-age 10080')
      )
      process.exit(2)
    }
  }

  // Load project config from .inuprc. Before the dirty-tree prompt, so a broken config fails
  // the run before it asks anything.
  const projectConfig = loadProjectConfigOrExit(cwd)

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

  // Merge CLI exclude patterns with config
  const excludePatterns = [...splitList(options.exclude), ...(projectConfig.exclude || [])]

  // Merge CLI ignore patterns with config (CLI takes precedence / adds to config)
  const ignorePackages = [
    ...new Set([...splitList(options.ignore), ...(projectConfig.ignore || [])]),
  ]

  const maxDepth = Number.parseInt(options.maxDepth, 10)
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    console.error(chalk.red(`Invalid max depth: ${options.maxDepth}`))
    console.error(chalk.yellow('Expected a non-negative integer, for example: --max-depth 10'))
    process.exit(2)
  }

  let concurrency: number | undefined
  if (options.concurrency !== undefined) {
    const parsed = Number(options.concurrency)
    if (!isValidConcurrency(parsed)) {
      console.error(chalk.red(`Invalid concurrency: ${options.concurrency}`))
      console.error(
        chalk.yellow(
          `Expected an integer between 1 and ${POOL_CONNECTIONS}, for example: --concurrency 4`
        )
      )
      process.exit(2)
    }
    concurrency = parsed
  }

  // Check for updates in the background (non-blocking). Interactive only — keeps headless stdout
  // clean and avoids a lingering fetch handle in CI.
  const updateCheckPromise = interactive
    ? checkForUpdateAsync(PACKAGE_NAME, PACKAGE_VERSION)
    : undefined

  // Native core: flag (--native / --no-native) > .inuprc > on. Headless runs left on the default
  // only use a core an earlier run cached: a download would hold CI and --json runs open until it
  // lands. Loaded only when on, so --no-native runs never touch it.
  const nativeChoice = options.native ?? projectConfig.native
  if (nativeChoice ?? true) {
    const { configureNativeCore } = await import('./shared/registry/rust-core')
    configureNativeCore({ enabled: true, download: interactive || nativeChoice === true })
  }

  const runnerOptions: UpgradeOptions = {
    cwd,
    excludePatterns,
    scanDirs: projectConfig.scanDirs,
    maxDepth,
    ignorePackages,
    ignoreMajorPackages: projectConfig.ignoreMajor,
    packageManager: options.packageManager,
    showPeerDependencyVulnerabilities: projectConfig.showPeerDependencyVulnerabilities ?? false,
    showOptionalDependencyVulnerabilities:
      projectConfig.showOptionalDependencyVulnerabilities ?? false,
    saveExact: options.saveExact ?? false,
    // CLI wins over .inuprc for the scalar; the exclusion list only comes from config.
    minimumReleaseAge: cliMinimumReleaseAge ?? projectConfig.minimumReleaseAge ?? 0,
    minimumReleaseAgeExclude: projectConfig.minimumReleaseAgeExclude,
    // Pinned parallelism: flag > .inuprc; undefined lets the controller adapt.
    concurrency: concurrency ?? projectConfig.concurrency,
  }

  // Non-interactive (piped / CI / --json / --check) routes to the read-only headless feature;
  // only the interactive path builds the full TUI runner. Each runner is imported
  // on its own path: the TUI graph (renderer, themes, changelog, wrap-ansi, …)
  // is most of what a --json run used to load at startup.
  if (!interactive) {
    const { HeadlessRunner } = await import('./features/headless')
    await new HeadlessRunner(runnerOptions).run({
      json: options.json,
      check: options.check,
      apply: options.apply,
      target: options.target,
    })
    return
  }

  const { UpgradeRunner } = await import('./index')
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
  .option(
    '--init',
    'create a commented .inuprc template documenting every option (asks before overwriting)'
  )
  .addOption(
    new Option('--package-manager <name>', 'manually specify package manager').choices(
      PACKAGE_MANAGER_NAMES
    )
  )
  .option(
    '--debug',
    'write verbose debug log to inup/inup-debug-YYYY-MM-DD.log in the system temp dir'
  )
  .option('--no-color', 'disable colored output (also respects NO_COLOR / FORCE_COLOR)')
  .option('--save-exact', 'write exact versions instead of preserving the range prefix (^/~)')
  .option(
    '--concurrency <n>',
    'pin registry-fetch parallelism (1-24) and disable adaptive ramping — for slow or metered connections'
  )
  .option(
    '--native',
    'use the native (Rust) registry core, on by default; downloads it on first use, even in headless runs'
  )
  .option('--no-native', 'use the TypeScript registry core for this run')
  .option('--json', 'print a machine-readable JSON report and exit (non-interactive, read-only)')
  .option('-c, --check', 'exit non-zero if updates exist, without writing (for CI; read-only)')
  .option(
    '--apply',
    'non-interactively write upgrades to package.json and run install (honors .inuprc ignore/exclude)'
  )
  .option(
    '--minimum-release-age <minutes>',
    'only offer versions published at least this many minutes ago (supply-chain cooldown; also via .inuprc)'
  )
  // No commander default: HeadlessRunner owns the 'minor' default for an absent target.
  .addOption(
    new Option(
      '--target <level>',
      'with --apply: how far to bump — minor (in-range) | patch (same major.minor only) | latest (default: minor)'
    ).choices(['minor', 'patch', 'latest'] satisfies ApplyTarget[])
  )
  // Exit codes: 0 ok, 1 updates exist (--check), 2 error. Commander exits 1 on a usage error,
  // which --check would read as "updates exist"; --help and --version keep their 0.
  .exitOverride((error) => process.exit(error.exitCode === 0 ? 0 : 2))
  .action(runCli)

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Uncaught Exception:'), error.message)
  process.exit(2)
})

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('Unhandled Rejection:'), reason)
  process.exit(2)
})

// Cancelled runs exit 128 + signal number, as a shell reports them, so `inup && git commit …`
// stops. The notice goes to stderr to keep `--json` stdout a pure document.
process.on('SIGINT', () => {
  console.error(chalk.yellow('\n\nOperation cancelled by user.'))
  process.exit(130)
})

process.on('SIGTERM', () => {
  console.error(chalk.yellow('\n\nOperation cancelled.'))
  process.exit(143)
})

if (require.main === module) {
  program.parse()
}
