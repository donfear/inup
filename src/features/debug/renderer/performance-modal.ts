import chalk from 'chalk'
import { ModalSection, renderModalFrame } from '../../../ui/modal'
import { PerformanceSnapshot } from '../types/debug.types'

function formatMs(value: number | undefined | null): string {
  if (value === undefined || value === null) return chalk.gray('—')
  return chalk.yellow(`${value} ms`)
}

function formatCount(value: number | undefined): string {
  if (value === undefined) return chalk.gray('—')
  return chalk.cyan(String(value))
}

function labelValue(label: string, value: string, labelWidth = 22): string {
  const padded = label.padEnd(labelWidth, ' ')
  return `${chalk.white(padded)} ${value}`
}

export function renderPerformanceModal(
  snapshot: PerformanceSnapshot,
  terminalWidth: number = 80,
  terminalHeight: number = 24
): string[] {
  const { phases, counts, batches, failedPackages, packageManager, totalMs } = snapshot

  const headerRows = [
    chalk.cyan('⚡ Performance'),
    chalk.gray(
      `Package manager: ${packageManager ? chalk.white(packageManager) : chalk.gray('unknown')}`
    ),
  ]

  const timingRows = [
    labelValue('Discovery', formatMs(phases.discovery)),
    labelValue('Dep collection', formatMs(phases.depCollection)),
    labelValue('Filter', formatMs(phases.filter)),
    labelValue('Registry fetch', formatMs(phases.registryFetch)),
    labelValue('First batch ready', formatMs(phases.firstBatch)),
    labelValue('All packages loaded', formatMs(phases.allLoaded)),
    labelValue('Elapsed total', formatMs(totalMs ?? undefined)),
  ]

  const countRows = [
    labelValue('package.json files', formatCount(counts.packageJsonFiles)),
    labelValue('Raw dependencies', formatCount(counts.rawDependencies)),
    labelValue('Unique packages', formatCount(counts.uniquePackages)),
    labelValue('Ignored', formatCount(counts.ignoredPackages)),
    labelValue('Workspace refs', formatCount(counts.workspaceRefsSkipped)),
    labelValue('Resolved', formatCount(counts.resolved)),
    labelValue('Failed', formatCount(counts.failed)),
  ]

  const batchRows: string[] = []
  if (batches.length > 0) {
    const durations = batches.map((b) => b.durationMs)
    const total = durations.reduce((a, b) => a + b, 0)
    const avg = Math.round(total / batches.length)
    const slowest = Math.max(...durations)
    const slowestBatch = batches.find((b) => b.durationMs === slowest)
    batchRows.push(
      labelValue('Batch count', formatCount(batches.length)),
      labelValue('Avg batch', formatMs(avg)),
      labelValue('Slowest batch', `${formatMs(slowest)} ${chalk.gray(`(#${slowestBatch?.index})`)}`)
    )
  } else {
    batchRows.push(chalk.gray('  (no batches recorded)'))
  }

  const failureRows: string[] = []
  if (failedPackages.length > 0) {
    const shown = failedPackages.slice(0, 10)
    for (const name of shown) {
      failureRows.push(`  ${chalk.red('✗')} ${name}`)
    }
    if (failedPackages.length > shown.length) {
      failureRows.push(chalk.gray(`  … and ${failedPackages.length - shown.length} more`))
    }
  } else {
    failureRows.push(chalk.gray('  (none)'))
  }

  const sections: ModalSection[] = [
    { key: 'header', rows: headerRows, required: true },
    { key: 'timings-title', rows: [chalk.bold('Timings')], required: true },
    { key: 'timings', rows: timingRows, required: true },
    { key: 'counts-title', rows: ['', chalk.bold('Counts')], required: true },
    { key: 'counts', rows: countRows, required: true },
    { key: 'batches-title', rows: ['', chalk.bold('Batches')], required: true },
    { key: 'batches', rows: batchRows, required: true },
    { key: 'failures-title', rows: ['', chalk.bold('Failures')], required: true },
    { key: 'failures', rows: failureRows, required: true },
    { key: 'instructions', rows: ['', chalk.gray('! or Esc to close')], required: true },
  ]

  return renderModalFrame(sections, {
    terminalWidth,
    terminalHeight,
    minWidth: 64,
    maxWidth: 84,
  })
}
