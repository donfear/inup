import chalk from 'chalk'
import { ModalSection, renderModalFrame } from '../../../ui/modal'
import { PerformanceSnapshot } from '../types/debug.types'

function formatMs(value: number | undefined): string {
  if (value === undefined) return chalk.gray('—')
  return chalk.yellow(`${value} ms`)
}

export function renderPerformanceModal(
  snapshot: PerformanceSnapshot,
  terminalWidth: number = 80,
  terminalHeight: number = 24
): string[] {
  const metricRows: string[] = [
    `${chalk.white('First batch ready')}   ${formatMs(snapshot.phases.firstBatch)}`,
    `${chalk.white('All packages loaded')} ${formatMs(snapshot.phases.allLoaded)}`,
    `${chalk.white('Elapsed total')}       ${formatMs(snapshot.totalMs ?? undefined)}`,
  ]

  const sections: ModalSection[] = [
    {
      key: 'header',
      rows: [chalk.cyan('⚡ Performance')],
      required: true,
    },
    {
      key: 'metrics',
      rows: metricRows,
      required: true,
    },
    {
      key: 'instructions',
      rows: [chalk.gray('! or Esc to close')],
      required: true,
    },
  ]

  return renderModalFrame(sections, {
    terminalWidth,
    terminalHeight,
    minWidth: 60,
    maxWidth: 76,
  })
}
