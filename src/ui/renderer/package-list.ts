import chalk from 'chalk'
import { PackageSelectionState, RenderableItem } from '../../types'
import { VersionUtils } from '../utils'

/**
 * Render a single package line
 */
export function renderPackageLine(state: PackageSelectionState, index: number, isCurrentRow: boolean): string {
  const prefix = isCurrentRow ? chalk.green('❯ ') : '  '

  // Package name with special formatting for scoped packages (@author/package)
  let packageName
  if (state.name.startsWith('@')) {
    const parts = state.name.split('/')
    if (parts.length >= 2) {
      const author = parts[0] // @author
      const packagePart = parts.slice(1).join('/') // package name

      if (isCurrentRow) {
        packageName = chalk.white.bold(author) + chalk.cyan('/' + packagePart)
      } else {
        packageName = chalk.white.bold(author) + chalk.white('/' + packagePart)
      }
    } else {
      packageName = isCurrentRow ? chalk.cyan(state.name) : chalk.white(state.name)
    }
  } else {
    packageName = isCurrentRow ? chalk.cyan(state.name) : chalk.white(state.name)
  }

  // Determine which dot should be filled (only one per package)
  const isCurrentSelected = state.selectedOption === 'none'
  const isRangeSelected = state.selectedOption === 'range'
  const isLatestSelected = state.selectedOption === 'latest'

  // Current version dot and version (show original specifier with prefix)
  const currentDot = isCurrentSelected ? chalk.green('●') : chalk.gray('○')
  const currentVersion = chalk.white(state.currentVersionSpecifier)

  // Range version dot and version
  let rangeDot = ''
  let rangeVersionText = ''
  let rangeDashes = ''
  if (state.hasRangeUpdate) {
    rangeDot = isRangeSelected ? chalk.green('●') : chalk.gray('○')
    const rangeVersionWithPrefix = VersionUtils.applyVersionPrefix(
      state.currentVersionSpecifier,
      state.rangeVersion
    )
    rangeVersionText = chalk.yellow(rangeVersionWithPrefix)
    rangeDashes = ''
  } else {
    rangeDot = chalk.gray('○')
    rangeVersionText = ''
    rangeDashes = chalk.gray('─')
  }

  // Latest version dot and version
  let latestDot = ''
  let latestVersionText = ''
  let latestDashes = ''
  if (state.hasMajorUpdate) {
    latestDot = isLatestSelected ? chalk.green('●') : chalk.gray('○')
    const latestVersionWithPrefix = VersionUtils.applyVersionPrefix(
      state.currentVersionSpecifier,
      state.latestVersion
    )
    latestVersionText = chalk.red(latestVersionWithPrefix)
    latestDashes = ''
  } else {
    latestDot = chalk.gray('○')
    latestVersionText = ''
    latestDashes = chalk.gray('─')
  }

  // Fixed column widths for perfect alignment
  const packageNameWidth = 38 // Total package column width minus prefix (2 chars)
  const currentColumnWidth = 16 // Increased to accommodate ^ and ~ prefixes
  const rangeColumnWidth = 16 // Increased to accommodate ^ and ~ prefixes
  const latestColumnWidth = 16 // Increased to accommodate ^ and ~ prefixes

  // Package name with fixed width and dashes
  const nameLength = state.name.length
  const namePadding = Math.max(0, packageNameWidth - nameLength - 1) // -1 for space after package name
  const nameDashes = '-'.repeat(namePadding)
  const dashColor = isCurrentRow ? chalk.white : chalk.gray
  const packageNameSection = `${packageName} ${dashColor(nameDashes)}`

  // Current version section with fixed width
  const currentSection = `${currentDot} ${currentVersion}`
  const currentSectionLength = VersionUtils.getVisualLength(currentSection) + 1 // +1 for space before dashes
  const currentPadding = Math.max(0, currentColumnWidth - currentSectionLength)
  const currentWithPadding = currentSection + ' ' + dashColor('-').repeat(currentPadding)

  // Range version section with fixed width
  let rangeSection = ''
  if (state.hasRangeUpdate) {
    rangeSection = `${rangeDot} ${rangeVersionText}`
    const rangeSectionLength = VersionUtils.getVisualLength(rangeSection) + 1 // +1 for space before dashes
    const rangePadding = Math.max(0, rangeColumnWidth - rangeSectionLength)
    rangeSection += ' ' + dashColor('-').repeat(rangePadding)
  } else {
    // Empty slot - just spaces to maintain column width
    rangeSection = ' '.repeat(rangeColumnWidth)
  }

  // Latest version section with fixed width
  let latestSection = ''
  if (state.hasMajorUpdate) {
    latestSection = `${latestDot} ${latestVersionText}`
    const latestSectionLength = VersionUtils.getVisualLength(latestSection) + 1 // +1 for space before dashes
    const latestPadding = Math.max(0, latestColumnWidth - latestSectionLength)
    latestSection += ' ' + dashColor('-').repeat(latestPadding)
  } else {
    // Empty slot - just spaces to maintain column width
    latestSection = ' '.repeat(latestColumnWidth)
  }

  // Build line with fixed column widths
  const line = `${prefix}${packageNameSection}   ${currentWithPadding}   ${rangeSection}   ${latestSection}`

  return line
}

/**
 * Render section header
 */
export function renderSectionHeader(title: string, sectionType: 'main' | 'peer' | 'optional'): string {
  const colorFn =
    sectionType === 'main' ? chalk.cyan : sectionType === 'peer' ? chalk.magenta : chalk.yellow
  return '  ' + colorFn.bold(title)
}

/**
 * Render spacer
 */
export function renderSpacer(): string {
  return ''
}

/**
 * Render the main interface
 */
export function renderInterface(
  states: PackageSelectionState[],
  currentRow: number,
  scrollOffset: number,
  maxVisibleItems: number,
  forceFullRender: boolean,
  renderableItems?: RenderableItem[],
  dependencyTypeLabel?: string,
  packageManager?: any,
  filterMode?: boolean,
  filterQuery?: string,
  totalPackagesBeforeFilter?: number
): string[] {
  const output: string[] = []

  // Header section (same for initial and incremental render)
  if (packageManager) {
    // Color map for each package manager - use their primary color for main text
    const colorMap: { [key: string]: (text: string) => string } = {
      npm: chalk.red,
      yarn: chalk.blue,
      pnpm: chalk.yellow,
      bun: chalk.magenta,
    }
    const pmColor = colorMap[packageManager.name] || packageManager.color
    // Each character in "inup" gets a different color
    const inupColors = [chalk.red, chalk.yellow, chalk.blue, chalk.magenta]
    const coloredInup = inupColors.map((color, i) => color.bold('inup'[i])).join('')
    const headerLine = '  ' + chalk.bold(pmColor('🚀')) + ' ' + coloredInup + chalk.gray(` (${packageManager.displayName})`)
    output.push(dependencyTypeLabel ? headerLine + chalk.gray(' - ') + chalk.bold.cyan(dependencyTypeLabel) : headerLine)
  } else {
    const headerLine = '  ' + chalk.bold.blue('🚀 ') + chalk.bold.red('i') + chalk.bold.yellow('n') + chalk.bold.blue('u') + chalk.bold.magenta('p')
    output.push(dependencyTypeLabel ? headerLine + chalk.gray(' - ') + chalk.bold.cyan(dependencyTypeLabel) : headerLine)
  }
  output.push('')

  if (filterMode) {
    // Show filter input with cursor when actively filtering
    const filterDisplay = '  ' + chalk.bold.white('Search: ') + chalk.cyan(filterQuery || '') + chalk.gray('█')
    output.push(filterDisplay)
  } else {
    // Show instructions when not filtering
    output.push(
      '  ' +
        chalk.bold.white('/ ') +
        chalk.gray('Search') +
        '  ' +
        chalk.bold.white('↑/↓ ') +
        chalk.gray('Move') +
        '  ' +
        chalk.bold.white('←/→ ') +
        chalk.gray('Select') +
        '  ' +
        chalk.bold.white('I ') +
        chalk.gray('Info') +
        '  ' +
        chalk.bold.white('M ') +
        chalk.gray('Minor') +
        '  ' +
        chalk.bold.white('L ') +
        chalk.gray('All') +
        '  ' +
        chalk.bold.white('U ') +
        chalk.gray('None')
    )
  }

  // Show status line with item range
  const totalPackages = states.length
  const totalBeforeFilter = totalPackagesBeforeFilter || totalPackages
  // Use renderableItems length only if we have renderable items (grouped mode), otherwise use totalPackages (flat mode)
  const totalVisualItems =
    renderableItems && renderableItems.length > 0 ? renderableItems.length : totalPackages
  const startItem = scrollOffset + 1
  const endItem = Math.min(scrollOffset + maxVisibleItems, totalVisualItems)

  let statusLine = ''
  if (filterMode) {
    // In filter mode, show ESC to exit filter
    if (totalPackages === 0) {
      statusLine = chalk.yellow(`No matches found`) +
        '  ' +
        chalk.gray('Esc ') +
        chalk.gray('Clear filter')
    } else if (totalVisualItems > maxVisibleItems) {
      statusLine = chalk.gray(
        `Showing ${chalk.white(startItem)}-${chalk.white(endItem)} of ${chalk.white(totalPackages)} matches (${chalk.white(totalBeforeFilter)} total)`
      ) +
        '  ' +
        chalk.gray('Esc ') +
        chalk.gray('Clear filter')
    } else {
      statusLine = chalk.gray(`Showing all ${chalk.white(totalPackages)} matches (${chalk.white(totalBeforeFilter)} total)`) +
        '  ' +
        chalk.gray('Esc ') +
        chalk.gray('Clear filter')
    }
  } else if (totalPackages < totalBeforeFilter) {
    // Filter is applied but not in filter mode
    if (totalVisualItems > maxVisibleItems) {
      statusLine = chalk.gray(
        `Showing ${chalk.white(startItem)}-${chalk.white(endItem)} of ${chalk.white(totalPackages)} matches (${chalk.white(totalBeforeFilter)} total)`
      ) +
        '  ' +
        chalk.gray('/ ') +
        chalk.gray('Edit filter') +
        '  ' +
        chalk.gray('Enter ') +
        chalk.gray('Confirm') +
        '  ' +
        chalk.gray('Esc ') +
        chalk.gray('Cancel')
    } else {
      statusLine = chalk.gray(`Showing all ${chalk.white(totalPackages)} matches (${chalk.white(totalBeforeFilter)} total)`) +
        '  ' +
        chalk.gray('/ ') +
        chalk.gray('Edit filter') +
        '  ' +
        chalk.gray('Enter ') +
        chalk.gray('Confirm') +
        '  ' +
        chalk.gray('Esc ') +
        chalk.gray('Cancel')
    }
  } else {
    // No filter applied
    if (totalVisualItems > maxVisibleItems) {
      statusLine = chalk.gray(
        `Showing ${chalk.white(startItem)}-${chalk.white(endItem)} of ${chalk.white(totalPackages)} packages`
      ) +
        '  ' +
        chalk.gray('Enter ') +
        chalk.gray('Confirm') +
        '  ' +
        chalk.gray('Esc ') +
        chalk.gray('Cancel')
    } else {
      statusLine = chalk.gray(`Showing all ${chalk.white(totalPackages)} packages`) +
        '  ' +
        chalk.gray('Enter ') +
        chalk.gray('Confirm') +
        '  ' +
        chalk.gray('Esc ') +
        chalk.gray('Cancel')
    }
  }

  output.push('  ' + statusLine)
  output.push('')

  // Render visible items
  if (renderableItems && renderableItems.length > 0) {
    // Use renderable items for grouped display
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
          item.originalIndex === currentRow
        )
        output.push(line)
      }
    }
  } else {
    // Fallback to flat rendering (legacy mode)
    for (let i = scrollOffset; i < Math.min(scrollOffset + maxVisibleItems, states.length); i++) {
      const line = renderPackageLine(states[i], i, i === currentRow)
      output.push(line)
    }
  }

  return output
}

/**
 * Render packages table
 */
export function renderPackagesTable(packages: any[]): string {
  if (packages.length === 0) {
    return chalk.green('✅ All packages are up to date!')
  }

  const outdatedPackages = packages.filter((p) => p.isOutdated)

  if (outdatedPackages.length === 0) {
    return chalk.green('✅ All packages are up to date!')
  }

  // Just show a simple message, the interactive interface will handle the display
  return chalk.bold.blue('🚀 inup\n')
}
