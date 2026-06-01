import chalk from 'chalk'
import { PackageDetector } from '../../core/package-detector'
import type { UpgradeOptions } from '../../types'
import { auditVulnerabilities } from './vulnerability-audit'
import { buildHeadlessReport, renderPlainReport } from './report'
import { HeadlessOptions } from './types'

/**
 * Non-interactive entry point. Resolves the outdated list without rendering the TUI, then either
 * emits a JSON report (--json) or a plain line-based report. With --check, sets a non-zero exit
 * code when updates exist so CI can gate on it. Read-only: never writes package.json or installs.
 *
 * This is the headless counterpart to the interactive `UpgradeRunner`; it shares only the
 * `PackageDetector` (the scan/resolve layer), not the UI/upgrade machinery.
 */
export class HeadlessRunner {
  private detector: PackageDetector

  constructor(options?: UpgradeOptions) {
    this.detector = new PackageDetector(options)
  }

  async run(options: HeadlessOptions): Promise<void> {
    try {
      if (!this.detector.hasPackageJson()) {
        throw new Error('No package.json found in current directory')
      }

      const packages = await this.detector.getOutdatedPackages()
      const outdated = this.detector.getOutdatedPackagesOnly(packages)

      // Audit the current versions (one bulk request, best-effort) and cross-reference each
      // advisory against the upgrade targets, so the report says whether upgrading *fixes* it.
      const vulnerabilities = await auditVulnerabilities(outdated)

      if (options.json) {
        // stdout is reserved for the JSON document only.
        console.log(JSON.stringify(buildHeadlessReport(packages, outdated, vulnerabilities), null, 2))
      } else {
        console.log(renderPlainReport(outdated, vulnerabilities))
      }

      // Exit 1 only means "updates exist" (like `prettier --check`); 2 is reserved for errors.
      if (options.check && outdated.length > 0) {
        process.exitCode = 1
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
      process.exit(2)
    }
  }
}
