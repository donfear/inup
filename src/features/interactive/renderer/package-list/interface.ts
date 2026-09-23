import chalk from 'chalk'
import { truncatePlainText } from '../../../../shared/terminal'
import type {
  AuditProgress,
  PackageLoadProgress,
  PackageManagerInfo,
  PackageSelectionState,
} from '../../../../shared/types'
import { getFooterHints } from '../../keymap'
import { getThemeColor, inupLogo } from '../../themes-colors'
import { VersionUtils } from '../version-format'
import {
  computeVersionColumnWidths,
  type PackageListRenderOptions,
  padLineToWidth,
  renderPackageLine,
} from './rows'

function scanLabel(progress: PackageLoadProgress | undefined, width: number): string | undefined {
  if (progress?.phase === 'discovering') {
    const label = 'Scanning for package.json files…'
    const detail = progress.scanningDir
      ? ` ${progress.scanningDir} (found ${progress.packageJsonFiles ?? 0})`
      : ''
    return VersionUtils.getVisualLength(label + detail) <= width ? label + detail : label
  }
  if (progress?.phase === 'collecting') {
    return `Reading dependencies from ${progress.packageJsonFiles ?? 0} package.json files…`
  }
  return undefined
}

export function renderInterface(
  states: PackageSelectionState[],
  currentRow: number,
  scrollOffset: number,
  maxVisibleItems: number,
  activeFilterLabel?: string,
  packageManager?: PackageManagerInfo,
  filterMode?: boolean,
  filterQuery?: string,
  totalPackagesBeforeFilter?: number,
  terminalWidth: number = 80,
  loadingProgress?: PackageLoadProgress,
  auditProgress?: AuditProgress,
  options: PackageListRenderOptions = {},
  notice?: string | null
): string[] {
  const output: string[] = []

  // Appended to the header. These packages are not outdated any more — every version newer
  // than the installed one is inside the window — so the default list has no row for them
  // and the cooldown would otherwise be silent, which is the one thing a security control
  // must never be. The count says "not listed" and names the key that reveals them, because
  // a bare number beside a short list reads as a contradiction and a number nobody can act
  // on is worse than no number at all.
  //
  // "fully held" because rows in the list carry `[HELD]` too, and those are a different
  // thing: they have an upgrade you can take AND something newer that was withheld. These
  // have nothing left to take at all. Without the word, the count reads as a claim that
  // held packages are not listed, which every badge on screen contradicts.
  //
  // It disappears once they ARE listed. Its job is done at that point, and it counts unique
  // package NAMES while the list counts rows — one per (name, specifier, dependency type),
  // so a package declared twice is two rows. Both numbers are right and side by side they
  // look like a bug.
  const heldCount = options.cooldown?.heldCount ?? 0
  const heldSuffix = options.cooldown?.unsupported
    ? getThemeColor('warning')('  cooldown inactive: registry has no publish times')
    : heldCount > 0 && !options.cooldownHeldShown
      ? getThemeColor('warning')(`  ${heldCount} fully held by cooldown, not listed — press c`)
      : ''

  const headerLine =
    '  ' +
    inupLogo() +
    (packageManager ? getThemeColor('textSecondary')(` (${packageManager.displayName})`) : '')
  const fullHeaderLine =
    (activeFilterLabel
      ? headerLine +
        getThemeColor('textSecondary')(' - ') +
        getThemeColor('primary')(activeFilterLabel)
      : headerLine) + heldSuffix
  const headerPadding = Math.max(0, terminalWidth - VersionUtils.getVisualLength(fullHeaderLine))
  output.push(fullHeaderLine + ' '.repeat(headerPadding))
  output.push('')

  if (filterMode) {
    const filterDisplay =
      '  ' +
      chalk.bold.white('Search: ') +
      getThemeColor('primary')(filterQuery || '') +
      getThemeColor('border')('█')
    const padding = Math.max(0, terminalWidth - VersionUtils.getVisualLength(filterDisplay))
    output.push(filterDisplay + ' '.repeat(padding))
  } else if (filterQuery) {
    const filterDisplay =
      '  ' +
      chalk.bold.white('Search: ') +
      getThemeColor('primary')(filterQuery) +
      getThemeColor('textSecondary')(' (press / to edit)')
    const padding = Math.max(0, terminalWidth - VersionUtils.getVisualLength(filterDisplay))
    output.push(filterDisplay + ' '.repeat(padding))
  } else {
    let hintLine = '  '
    for (const { keyLabel, label } of getFooterHints()) {
      const hint = chalk.bold.white(`${keyLabel} `) + getThemeColor('textSecondary')(label)
      const separator = hintLine === '  ' ? '' : '  '
      if (VersionUtils.getVisualLength(hintLine + separator + hint) > terminalWidth) break
      hintLine += separator + hint
    }
    output.push(hintLine)
  }

  const totalPackages = states.length
  const scanStatus = scanLabel(loadingProgress, terminalWidth - 2)
  const totalBeforeFilter = totalPackagesBeforeFilter || totalPackages
  const startItem = scrollOffset + 1
  const endItem = Math.min(scrollOffset + maxVisibleItems, totalPackages)

  let statusLine = ''
  if (filterMode) {
    if (totalPackages === 0) {
      statusLine =
        getThemeColor('warning')(`No matches found`) +
        '  ' +
        chalk.bold.white('Esc ') +
        chalk.gray('Clear')
    } else if (totalPackages > maxVisibleItems) {
      statusLine =
        getThemeColor('textSecondary')(
          `Showing ${chalk.white(startItem)}-${chalk.white(endItem)} of ${chalk.white(totalPackages)} matches`
        ) +
        '  ' +
        chalk.bold.white('Enter ') +
        chalk.gray('Apply') +
        '  ' +
        chalk.bold.white('Esc ') +
        chalk.gray('Clear')
    } else {
      statusLine =
        getThemeColor('textSecondary')(`Showing all ${chalk.white(totalPackages)} matches`) +
        '  ' +
        chalk.bold.white('Enter ') +
        chalk.gray('Apply') +
        '  ' +
        chalk.bold.white('Esc ') +
        chalk.gray('Clear')
    }
  } else if (totalPackages < totalBeforeFilter) {
    // Footer already lists D/P/O, M, L, U — status line just shows count + Esc.
    const matchCount =
      totalPackages > maxVisibleItems
        ? getThemeColor('textSecondary')(
            `Showing ${chalk.white(startItem)}-${chalk.white(endItem)} of ${chalk.white(totalPackages)} matches`
          )
        : getThemeColor('textSecondary')(`Showing all ${chalk.white(totalPackages)} matches`)
    statusLine = `${matchCount}  ${chalk.bold.white('Esc ')}${chalk.gray('Clear filter')}`
  } else {
    if (totalPackages > maxVisibleItems) {
      statusLine =
        chalk.gray(
          `Showing ${chalk.white(startItem)}-${chalk.white(endItem)} of ${chalk.white(totalPackages)} packages`
        ) +
        '  ' +
        chalk.bold.white('Enter ') +
        chalk.gray('Confirm')
    } else {
      statusLine =
        chalk.gray(`Showing all ${chalk.white(totalPackages)} packages`) +
        '  ' +
        chalk.bold.white('Enter ') +
        chalk.gray('Confirm')
    }
  }

  if (totalPackages === 0 && scanStatus) statusLine = getThemeColor('textSecondary')(scanStatus)

  // Enter applies every selected row, including ones the filter hides, so the
  // count covers them all and says how many are out of view.
  const selectedCount = options.selectedCount ?? 0
  if (selectedCount > 0) {
    const hiddenCount = selectedCount - states.filter((s) => s.selectedOption !== 'none').length
    const hidden = hiddenCount > 0 ? getThemeColor('warning')(` (${hiddenCount} hidden)`) : ''
    statusLine += `  ${getThemeColor('textSecondary')(`${selectedCount} selected`)}${hidden}`
  }

  if (auditProgress && auditProgress.total > 0) {
    const auditLabel = auditProgress.isRunning
      ? `Audit ${auditProgress.completed}/${auditProgress.total}`
      : `Audit ${auditProgress.total}/${auditProgress.total}`
    statusLine += `  ${getThemeColor('textSecondary')(auditLabel)}`
  }

  // A one-shot notice (e.g. "nothing selected") replaces the status line for a
  // single render so the layout height stays constant.
  const statusContent = notice ? getThemeColor('warning')(notice) : statusLine
  const statusLineFull = truncatePlainText(`  ${statusContent}`, terminalWidth)
  const statusPadding = Math.max(0, terminalWidth - VersionUtils.getVisualLength(statusLineFull))
  output.push(statusLineFull + ' '.repeat(statusPadding))
  output.push('')

  // Sized once per frame over every state (not the visible window), so the
  // columns hold still while scrolling and long prerelease versions get room.
  const columnWidths = options.columnWidths ?? computeVersionColumnWidths(states, terminalWidth)

  for (let i = scrollOffset; i < Math.min(scrollOffset + maxVisibleItems, states.length); i++) {
    output.push(
      renderPackageLine(states[i], i === currentRow, terminalWidth, options, columnWidths)
    )
  }

  if (loadingProgress?.isLoading && !(totalPackages === 0 && scanStatus)) {
    const loadingLabel =
      scanStatus ??
      `Loading packages... (${loadingProgress.resolved}/${loadingProgress.total} checked)`
    const failedLabel = loadingProgress.failed > 0 ? ` ${loadingProgress.failed} unavailable` : ''
    const slowLabel = loadingProgress.slowNetwork ? ' — slow connection, reduced parallelism' : ''
    let loadingLine =
      '  ' +
      getThemeColor('textSecondary')(loadingLabel) +
      (failedLabel ? chalk.yellow(failedLabel) : '')
    // The hint is informational only: drop it rather than overflow the row and
    // have the line cut off at the terminal edge.
    if (
      slowLabel &&
      VersionUtils.getVisualLength(loadingLine) + slowLabel.length <= terminalWidth
    ) {
      loadingLine += chalk.dim(slowLabel)
    }
    loadingLine = truncatePlainText(loadingLine, terminalWidth)
    const loadingPadding = Math.max(0, terminalWidth - VersionUtils.getVisualLength(loadingLine))
    output.push(loadingLine + ' '.repeat(loadingPadding))
  }

  return output.map((line) => padLineToWidth(line, terminalWidth))
}
