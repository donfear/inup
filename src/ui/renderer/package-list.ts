import chalk from 'chalk'
import { PackageSelectionState, RenderableItem } from '../../types'
import { VersionUtils } from '../utils'

/**
 * Remove ANSI color codes from a string for length calculation
 */
function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*m/g, '')
}

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
  isInitialRender: boolean,
  renderableItems?: RenderableItem[],
  dependencyTypeLabel?: string,
  packageManager?: any
): string[] {
  const output: string[] = []

  // Header section (same for initial and incremental render)
  if (packageManager) {
    output.push('  ' + packageManager.color.bold(`🚀 inup (${packageManager.displayName})`))
  } else {
    output.push('  ' + chalk.bold.magenta('🚀 inup'))
  }
  output.push('')

  // Show dependency type if provided
  if (dependencyTypeLabel) {
    output.push('  ' + chalk.bold.cyan(dependencyTypeLabel))
    output.push('')
  }
  output.push(
    '  ' +
      chalk.bold.white('↑/↓ ') +
      chalk.gray('Move') +
      '  ' +
      chalk.bold.white('←/→ ') +
      chalk.gray('Select versions') +
      '  ' +
      chalk.bold.white('I ') +
      chalk.gray('Info') +
      '  ' +
      chalk.bold.white('M ') +
      chalk.gray('Select all minor') +
      '  ' +
      chalk.bold.white('L ') +
      chalk.gray('Select all') +
      '  ' +
      chalk.bold.white('U ') +
      chalk.gray('Unselect all')
  )

  // Show status line with item range
  const totalPackages = states.length
  // Use renderableItems length only if we have renderable items (grouped mode), otherwise use totalPackages (flat mode)
  const totalVisualItems =
    renderableItems && renderableItems.length > 0 ? renderableItems.length : totalPackages
  const startItem = scrollOffset + 1
  const endItem = Math.min(scrollOffset + maxVisibleItems, totalVisualItems)
  const statusLine =
    totalVisualItems > maxVisibleItems
      ? chalk.gray(
          `Showing ${chalk.gray(startItem)}-${chalk.gray(endItem)} of ${chalk.gray(totalPackages)} packages`
        ) +
        '  ' +
        chalk.gray('Enter ') +
        chalk.gray('Confirm') +
        '  ' +
        chalk.gray('Esc ') +
        chalk.gray('Cancel')
      : chalk.gray(`Showing all ${chalk.gray(totalPackages)} packages`) +
        '  ' +
        chalk.gray('Enter ') +
        chalk.gray('Confirm') +
        '  ' +
        chalk.gray('Esc ') +
        chalk.gray('Cancel')
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
