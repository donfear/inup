import chalk from 'chalk'
import {
  AuditProgress,
  PackageLoadProgress,
  PackageSelectionState,
  RenderableItem,
} from '../../../types'
import { VersionUtils } from '../../utils'
import { getThemeColor, coloredInupLogo } from '../../themes-colors'
import { PACKAGE_NAME } from '../../../config'
import {
  padLineToWidth,
  renderPackageLine,
  renderSectionHeader,
  renderSpacer,
  PackageListRenderOptions,
} from './rows'

export function renderInterface(
  states: PackageSelectionState[],
  currentRow: number,
  scrollOffset: number,
  maxVisibleItems: number,
  _forceFullRender: boolean,
  renderableItems?: RenderableItem[],
  activeFilterLabel?: string,
  packageManager?: any,
  filterMode?: boolean,
  filterQuery?: string,
  totalPackagesBeforeFilter?: number,
  terminalWidth: number = 80,
  loadingProgress?: PackageLoadProgress,
  auditProgress?: AuditProgress,
  options: PackageListRenderOptions = {}
): string[] {
  const output: string[] = []

  if (packageManager) {
    const colorMap: { [key: string]: (text: string) => string } = {
      npm: chalk.red,
      yarn: chalk.blue,
      pnpm: chalk.yellow,
      bun: chalk.magenta,
    }
    const pmColor = colorMap[packageManager.name] || packageManager.color
    const headerLine =
      '  ' +
      chalk.bold(pmColor('🚀')) +
      ' ' +
      coloredInupLogo() +
      getThemeColor('textSecondary')(` (${packageManager.displayName})`)

    const fullHeaderLine = activeFilterLabel
      ? headerLine +
        getThemeColor('textSecondary')(' - ') +
        getThemeColor('primary')(activeFilterLabel)
      : headerLine
    const headerPadding = Math.max(0, terminalWidth - VersionUtils.getVisualLength(fullHeaderLine))
    output.push(fullHeaderLine + ' '.repeat(headerPadding))
  } else {
    const headerLine = '  ' + chalk.bold.blue('🚀 ') + coloredInupLogo()

    const fullHeaderLine = activeFilterLabel
      ? headerLine +
        getThemeColor('textSecondary')(' - ') +
        getThemeColor('primary')(activeFilterLabel)
      : headerLine
    const headerPadding = Math.max(0, terminalWidth - VersionUtils.getVisualLength(fullHeaderLine))
    output.push(fullHeaderLine + ' '.repeat(headerPadding))
  }
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
    output.push(
      '  ' +
        chalk.bold.white('/ ') +
        getThemeColor('textSecondary')('Search') +
        '  ' +
        chalk.bold.white('↑/↓ ') +
        getThemeColor('textSecondary')('Move') +
        '  ' +
        chalk.bold.white('←/→ ') +
        getThemeColor('textSecondary')('Select') +
        '  ' +
        chalk.bold.white('D/P/O ') +
        getThemeColor('textSecondary')('Filter') +
        '  ' +
        chalk.bold.white('I ') +
        getThemeColor('textSecondary')('Info') +
        '  ' +
        chalk.bold.white('S ') +
        getThemeColor('textSecondary')('Vulnerable') +
        '  ' +
        chalk.bold.white('M ') +
        getThemeColor('textSecondary')('Minor') +
        '  ' +
        chalk.bold.white('L ') +
        getThemeColor('textSecondary')('All') +
        '  ' +
        chalk.bold.white('U ') +
        getThemeColor('textSecondary')('None')
    )
  }

  const totalPackages = states.length
  const totalBeforeFilter = totalPackagesBeforeFilter || totalPackages
  const totalVisualItems =
    renderableItems && renderableItems.length > 0 ? renderableItems.length : totalPackages
  const startItem = scrollOffset + 1
  const endItem = Math.min(scrollOffset + maxVisibleItems, totalVisualItems)

  let statusLine = ''
  if (filterMode) {
    if (totalPackages === 0) {
      statusLine =
        getThemeColor('warning')(`No matches found`) +
        '  ' +
        chalk.bold.white('Esc ') +
        chalk.gray('Clear')
    } else if (totalVisualItems > maxVisibleItems) {
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
    if (totalVisualItems > maxVisibleItems) {
      statusLine =
        getThemeColor('textSecondary')(
          `Showing ${chalk.white(startItem)}-${chalk.white(endItem)} of ${chalk.white(totalPackages)} matches`
        ) +
        '  ' +
        chalk.bold.white('D/P/O ') +
        chalk.gray('Filter') +
        '  ' +
        chalk.bold.white('M ') +
        chalk.gray('Minor') +
        '  ' +
        chalk.bold.white('L ') +
        chalk.gray('All') +
        '  ' +
        chalk.bold.white('U ') +
        chalk.gray('None') +
        '  ' +
        chalk.bold.white('Esc ') +
        chalk.gray('Clear')
    } else {
      statusLine =
        getThemeColor('textSecondary')(`Showing all ${chalk.white(totalPackages)} matches`) +
        '  ' +
        chalk.bold.white('D/P/O ') +
        chalk.gray('Filter') +
        '  ' +
        chalk.bold.white('M ') +
        chalk.gray('Minor') +
        '  ' +
        chalk.bold.white('L ') +
        chalk.gray('All') +
        '  ' +
        chalk.bold.white('U ') +
        chalk.gray('None') +
        '  ' +
        chalk.bold.white('Esc ') +
        chalk.gray('Clear')
    }
  } else {
    if (totalVisualItems > maxVisibleItems) {
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

  if (auditProgress && auditProgress.total > 0) {
    const auditLabel = auditProgress.isRunning
      ? `Audit ${auditProgress.completed}/${auditProgress.total}`
      : `Audit ${auditProgress.total}/${auditProgress.total}`
    statusLine += '  ' + getThemeColor('textSecondary')(auditLabel)
  }

  const statusLineFull = '  ' + statusLine
  const statusPadding = Math.max(0, terminalWidth - VersionUtils.getVisualLength(statusLineFull))
  output.push(statusLineFull + ' '.repeat(statusPadding))
  output.push('')

  if (renderableItems && renderableItems.length > 0) {
    for (
      let i = scrollOffset;
      i < Math.min(scrollOffset + maxVisibleItems, renderableItems.length);
      i++
    ) {
      const item = renderableItems[i]
      if (item.type === 'header') {
        output.push(renderSectionHeader(item.title, item.sectionType))
      } else if (item.type === 'spacer') {
        output.push(renderSpacer())
      } else if (item.type === 'package') {
        const line = renderPackageLine(
          item.state,
          item.originalIndex,
          item.originalIndex === currentRow,
          terminalWidth,
          options
        )
        output.push(line)
      }
    }
  } else {
    for (let i = scrollOffset; i < Math.min(scrollOffset + maxVisibleItems, states.length); i++) {
      const line = renderPackageLine(states[i], i, i === currentRow, terminalWidth, options)
      output.push(line)
    }
  }

  if (loadingProgress?.isLoading) {
    const loadingLabel = `Loading packages... (${loadingProgress.resolved}/${loadingProgress.total} checked)`
    const failedLabel = loadingProgress.failed > 0 ? ` ${loadingProgress.failed} unavailable` : ''
    const loadingLine =
      '  ' +
      getThemeColor('textSecondary')(loadingLabel) +
      (failedLabel ? chalk.yellow(failedLabel) : '')
    const loadingPadding = Math.max(0, terminalWidth - VersionUtils.getVisualLength(loadingLine))
    output.push(loadingLine + ' '.repeat(loadingPadding))
  }

  return output.map((line) => padLineToWidth(line, terminalWidth))
}

export function renderPackagesTable(packages: any[]): string {
  if (packages.length === 0) {
    return chalk.green('✅ All packages are up to date!')
  }

  const outdatedPackages = packages.filter((p) => p.isOutdated)

  if (outdatedPackages.length === 0) {
    return chalk.green('✅ All packages are up to date!')
  }

  return chalk.bold.blue(`🚀 ${PACKAGE_NAME}\n`)
}
