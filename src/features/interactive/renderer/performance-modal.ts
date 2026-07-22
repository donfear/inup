import chalk from 'chalk'
import { clamp } from '../../../shared/math'
import type { PerformanceSnapshot } from '../../debug'
import {
  getModalWidth,
  type ModalRenderResult,
  type ModalSection,
  renderModalRow,
  renderModalSeparator,
} from '../modal'

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

function buildSections(snapshot: PerformanceSnapshot): {
  pinned: ModalSection[]
  body: ModalSection[]
} {
  const { phases, counts, batches, controlTicks, failedPackages, packageManager, totalMs } =
    snapshot

  const pinned: ModalSection[] = [
    {
      key: 'header',
      rows: [
        chalk.cyan('⚡ Performance'),
        chalk.gray(
          `Package manager: ${packageManager ? chalk.white(packageManager) : chalk.gray('unknown')}`
        ),
      ],
      required: true,
      behavior: 'pinned',
    },
  ]

  const bodyRows: string[] = []

  bodyRows.push(chalk.bold('Timings'))
  bodyRows.push(labelValue('Discovery', formatMs(phases.discovery)))
  bodyRows.push(labelValue('Dep collection', formatMs(phases.depCollection)))
  bodyRows.push(labelValue('Filter', formatMs(phases.filter)))
  bodyRows.push(labelValue('Registry fetch', formatMs(phases.registryFetch)))
  bodyRows.push(labelValue('First batch ready', formatMs(phases.firstBatch)))
  bodyRows.push(labelValue('All packages loaded', formatMs(phases.allLoaded)))
  bodyRows.push(labelValue('Elapsed total', formatMs(totalMs ?? undefined)))

  bodyRows.push('')
  bodyRows.push(chalk.bold('Counts'))
  bodyRows.push(labelValue('package.json files', formatCount(counts.packageJsonFiles)))
  bodyRows.push(labelValue('Raw dependencies', formatCount(counts.rawDependencies)))
  bodyRows.push(labelValue('Unique packages', formatCount(counts.uniquePackages)))
  bodyRows.push(labelValue('Ignored', formatCount(counts.ignoredPackages)))
  bodyRows.push(labelValue('Workspace refs', formatCount(counts.workspaceRefsSkipped)))
  bodyRows.push(labelValue('Resolved', formatCount(counts.resolved)))
  bodyRows.push(labelValue('Failed', formatCount(counts.failed)))

  bodyRows.push('')
  bodyRows.push(chalk.bold('Batches'))
  if (batches.length > 0) {
    const durations = batches.map((b) => b.durationMs)
    const total = durations.reduce((a, b) => a + b, 0)
    const avg = Math.round(total / batches.length)
    const slowest = Math.max(...durations)
    const slowestBatch = batches.find((b) => b.durationMs === slowest)
    bodyRows.push(labelValue('Batch count', formatCount(batches.length)))
    bodyRows.push(labelValue('Avg batch', formatMs(avg)))
    bodyRows.push(
      labelValue('Slowest batch', `${formatMs(slowest)} ${chalk.gray(`(#${slowestBatch?.index})`)}`)
    )
  } else {
    bodyRows.push(chalk.gray('  (no batches recorded)'))
  }

  bodyRows.push('')
  bodyRows.push(chalk.bold('Concurrency'))
  if (controlTicks.length > 0) {
    const limits = controlTicks.map((t) => t.limit)
    const finalTick = controlTicks[controlTicks.length - 1]
    const hardDowns = controlTicks.filter((t) => t.reason === 'hard-down').length
    // Hill-climb ticks carry a state; plain AIMD ticks never do.
    const isHillClimb = controlTicks.some((t) => t.state !== undefined)
    bodyRows.push(labelValue('Controller', chalk.cyan(isHillClimb ? 'hillclimb' : 'aimd')))
    bodyRows.push(labelValue('Start limit', formatCount(controlTicks[0].limit)))
    bodyRows.push(labelValue('Peak limit', formatCount(Math.max(...limits))))
    bodyRows.push(labelValue('Final limit', formatCount(finalTick.limit)))
    bodyRows.push(labelValue('Final EWMA', formatMs(finalTick.ewmaMs)))
    bodyRows.push(labelValue('Control ticks', formatCount(controlTicks.length)))
    bodyRows.push(labelValue('Hard back-offs', formatCount(hardDowns)))
    if (isHillClimb) {
      bodyRows.push(labelValue('State', chalk.cyan(finalTick.state ?? '—')))
      bodyRows.push(
        labelValue(
          'Last goodput',
          finalTick.goodputRps !== undefined
            ? chalk.yellow(`${finalTick.goodputRps}/s`)
            : chalk.gray('—')
        )
      )
    }
  } else {
    bodyRows.push(chalk.gray('  (fixed — adaptive off or run too small)'))
  }

  bodyRows.push('')
  bodyRows.push(chalk.bold('Failures'))
  if (failedPackages.length > 0) {
    for (const name of failedPackages) {
      bodyRows.push(`  ${chalk.red('✗')} ${name}`)
    }
  } else {
    bodyRows.push(chalk.gray('  (none)'))
  }

  const body: ModalSection[] = [
    {
      key: 'body',
      rows: bodyRows,
      required: true,
      behavior: 'body',
    },
  ]

  return { pinned, body }
}

export function renderPerformanceModal(
  snapshot: PerformanceSnapshot,
  terminalWidth: number = 80,
  terminalHeight: number = 24,
  scrollOffset: number = 0
): ModalRenderResult {
  const modalWidth = getModalWidth(terminalWidth, 60, 84)
  const padding = Math.floor((terminalWidth - modalWidth) / 2)
  const fixedModalHeight = Math.max(10, terminalHeight - 2)

  const { pinned, body } = buildSections(snapshot)
  const pinnedRowCount = pinned.reduce((sum, s) => sum + s.rows.length, 0)
  // frame: top border + pinned rows + separator + body rows + bottom border
  const availableForBody = Math.max(3, fixedModalHeight - 2 - pinnedRowCount - 1)

  const bodyRows = body[0].rows
  const totalScrollableRows = bodyRows.length
  const needsScroll = totalScrollableRows > availableForBody
  const visibleBodyRows = needsScroll ? Math.max(1, availableForBody - 1) : availableForBody
  const maxScroll = Math.max(0, totalScrollableRows - visibleBodyRows)
  const clampedOffset = clamp(scrollOffset, 0, maxScroll)
  const visibleSlice = bodyRows.slice(clampedOffset, clampedOffset + visibleBodyRows)

  const lines: string[] = []
  const topPadding = Math.max(0, Math.floor((terminalHeight - fixedModalHeight) / 2))
  for (let i = 0; i < topPadding; i++) {
    lines.push('')
  }

  lines.push(' '.repeat(padding) + chalk.gray(`╭${'─'.repeat(modalWidth - 2)}╮`))

  for (const section of pinned) {
    for (const row of section.rows) {
      lines.push(renderModalRow(padding, modalWidth, row))
    }
  }

  lines.push(renderModalSeparator(padding, modalWidth))

  let renderedBodyRows = 0
  for (const row of visibleSlice) {
    lines.push(renderModalRow(padding, modalWidth, row))
    renderedBodyRows++
  }

  const footer = needsScroll
    ? chalk.gray(
        `Lines ${clampedOffset + 1}-${Math.min(clampedOffset + visibleBodyRows, totalScrollableRows)} of ${totalScrollableRows}`
      )
    : null

  const usedContentRows = pinnedRowCount + 1 + renderedBodyRows + (footer ? 1 : 0)
  const totalContentSlots = fixedModalHeight - 2
  const emptyRows = Math.max(0, totalContentSlots - usedContentRows)
  for (let i = 0; i < emptyRows; i++) {
    lines.push(renderModalRow(padding, modalWidth, ''))
  }

  if (footer) {
    lines.push(renderModalRow(padding, modalWidth, footer))
  }

  lines.push(' '.repeat(padding) + chalk.gray(`╰${'─'.repeat(modalWidth - 2)}╯`))

  return {
    lines,
    maxScrollOffset: maxScroll,
    totalContentRows: totalScrollableRows,
    usesInternalScroll: needsScroll,
  }
}
