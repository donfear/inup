import chalk from 'chalk'
import { PackageSelectionState, RenderableItem, PackageInfo } from '../../types'
import { VersionUtils } from '../utils'
import { getThemeColor } from '../themes-colors'

/**
 * Get type badge for dependency type (theme-aware)
 */
function getTypeBadge(type: PackageInfo['type']): string {
  switch (type) {
    case 'devDependencies':
      return getThemeColor('textSecondary')('[D]')
    case 'peerDependencies':
      return getThemeColor('textSecondary')('[P]')
    case 'optionalDependencies':
      return getThemeColor('textSecondary')('[O]')
    case 'dependencies':
    default:
      return '' // No badge for regular dependencies
  }
}

/**
 * Render a single package line
 * @param state Package selection state
 * @param index Index in the list
 * @param isCurrentRow Whether this is the current/highlighted row
 * @param terminalWidth Terminal width for dynamic truncation (default 80)
 */
export function renderPackageLine(state: PackageSelectionState, index: number, isCurrentRow: boolean, terminalWidth: number = 80): string {
  const prefix = isCurrentRow ? getThemeColor('success')('❯ ') : '  '

  // Package name with special formatting for scoped packages (@author/package)
  let packageName
  if (state.name.startsWith('@')) {
    const parts = state.name.split('/')
    if (parts.length >= 2) {
      const author = parts[0] // @author
      const packagePart = parts.slice(1).join('/') // package name

      if (isCurrentRow) {
        packageName = chalk.bold(getThemeColor('packageAuthor')(author)) + getThemeColor('packageName')('/' + packagePart)
      } else {
        packageName = chalk.bold.white(author) + chalk.white('/' + packagePart)
      }
    } else {
      packageName = isCurrentRow ? getThemeColor('packageName')(state.name) : chalk.white(state.name)
    }
  } else {
    packageName = isCurrentRow ? getThemeColor('packageName')(state.name) : chalk.white(state.name)
  }

  // Determine which dot should be filled (only one per package)
  const isCurrentSelected = state.selectedOption === 'none'
  const isRangeSelected = state.selectedOption === 'range'
  const isLatestSelected = state.selectedOption === 'latest'

  // Current version dot and version (show original specifier with prefix)
  const currentDot = isCurrentSelected ? getThemeColor('dot')('●') : getThemeColor('dotEmpty')('○')
  const currentVersion = chalk.white(state.currentVersionSpecifier)

  // Range version dot and version
  let rangeDot = ''
  let rangeVersionText = ''
  if (state.hasRangeUpdate) {
    rangeDot = isRangeSelected ? getThemeColor('dot')('●') : getThemeColor('dotEmpty')('○')
    const rangeVersionWithPrefix = VersionUtils.applyVersionPrefix(
      state.currentVersionSpecifier,
      state.rangeVersion
    )
    rangeVersionText = getThemeColor('versionRange')(rangeVersionWithPrefix)
  } else {
    rangeDot = getThemeColor('dotEmpty')('○')
    rangeVersionText = ''
  }

  // Latest version dot and version
  let latestDot = ''
  let latestVersionText = ''
  if (state.hasMajorUpdate) {
    latestDot = isLatestSelected ? getThemeColor('dot')('●') : getThemeColor('dotEmpty')('○')
    const latestVersionWithPrefix = VersionUtils.applyVersionPrefix(
      state.currentVersionSpecifier,
      state.latestVersion
    )
    latestVersionText = getThemeColor('versionLatest')(latestVersionWithPrefix)
  } else {
    latestDot = getThemeColor('dotEmpty')('○')
    latestVersionText = ''
  }

  // Column widths with capped package name width
  // Layout: prefix(2) + name + dashes + spacing(3) + current(16) + spacing(3) + range(16) + spacing(3) + latest(16)
  const currentColumnWidth = 16 // Increased to accommodate ^ and ~ prefixes
  const rangeColumnWidth = 16 // Increased to accommodate ^ and ~ prefixes
  const latestColumnWidth = 16 // Increased to accommodate ^ and ~ prefixes
  const spacingWidth = 3

  // Package name width: max 50 chars (after which ellipsis kicks in), but scales down on small terminals
  const maxPackageNameWidth = 50
  const minPackageNameWidth = 24
  const otherColumnsWidth = currentColumnWidth + rangeColumnWidth + latestColumnWidth + spacingWidth * 3
  const prefixWidth = 2
  const availableForPackageName = terminalWidth - prefixWidth - otherColumnsWidth - 1
  const packageNameWidth = Math.min(maxPackageNameWidth, Math.max(minPackageNameWidth, availableForPackageName))

  // Apply ellipsis truncation if package name exceeds available width
  const badgeWidth = state.type === 'dependencies' ? 0 : 3 // [X] without leading space
  const truncatedName = VersionUtils.truncateMiddle(state.name, packageNameWidth - 1 - badgeWidth) // -1 for space after name, -badgeWidth for badge

  // Helper function to determine if dashes should be shown based on available padding
  // Only show dashes if there's significant padding (> 2 chars) to fill
  const shouldShowDashes = (paddingAmount: number): boolean => paddingAmount > 2

  const dashColor = isCurrentRow ? chalk.white : chalk.gray

  // Use truncated name if it differs from original, otherwise use colored packageName
  const displayName = truncatedName !== state.name ? truncatedName : packageName

  // Package name with dashes and badge at the end
  const typeBadge = getTypeBadge(state.type)
  const nameLength = VersionUtils.getVisualLength(truncatedName)
  const namePadding = Math.max(0, packageNameWidth - nameLength - 1 - badgeWidth) // -1 for space after package name, -badgeWidth for badge at end
  const nameDashes = shouldShowDashes(namePadding) ? dashColor('-').repeat(namePadding) : ' '.repeat(namePadding)

  // Place badge at the end of dashes: name ------[D]
  const packageNameSection = typeBadge
    ? `${displayName} ${nameDashes}${typeBadge}`
    : `${displayName} ${nameDashes}`

  // Current version section with dashes only if needed
  const currentSection = `${currentDot} ${currentVersion}`
  const currentSectionLength = VersionUtils.getVisualLength(currentSection) + 1 // +1 for space before padding
  const currentPadding = Math.max(0, currentColumnWidth - currentSectionLength)
  const currentPaddingText = shouldShowDashes(currentPadding) ? dashColor('-').repeat(currentPadding) : ' '.repeat(currentPadding)
  const currentWithPadding = currentSection + ' ' + currentPaddingText

  // Range version section with dashes only if needed
  let rangeSection = ''
  if (state.hasRangeUpdate) {
    rangeSection = `${rangeDot} ${rangeVersionText}`
    const rangeSectionLength = VersionUtils.getVisualLength(rangeSection) + 1 // +1 for space before padding
    const rangePadding = Math.max(0, rangeColumnWidth - rangeSectionLength)
    const rangePaddingText = shouldShowDashes(rangePadding) ? dashColor('-').repeat(rangePadding) : ' '.repeat(rangePadding)
    rangeSection += ' ' + rangePaddingText
  } else {
    // Empty slot - maintain column width
    rangeSection = ' '.repeat(rangeColumnWidth)
  }

  // Latest version section with dashes only if needed
  let latestSection = ''
  if (state.hasMajorUpdate) {
    latestSection = `${latestDot} ${latestVersionText}`
    const latestSectionLength = VersionUtils.getVisualLength(latestSection) + 1 // +1 for space before padding
    const latestPadding = Math.max(0, latestColumnWidth - latestSectionLength)
    const latestPaddingText = shouldShowDashes(latestPadding) ? dashColor('-').repeat(latestPadding) : ' '.repeat(latestPadding)
    latestSection += ' ' + latestPaddingText
  } else {
    // Empty slot - maintain column width
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
  activeFilterLabel?: string,
  packageManager?: any,
  filterMode?: boolean,
  filterQuery?: string,
  totalPackagesBeforeFilter?: number,
  terminalWidth: number = 80
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
    const headerLine = '  ' + chalk.bold(pmColor('🚀')) + ' ' + coloredInup + getThemeColor('textSecondary')(` (${packageManager.displayName})`)

    // Show filter state (always show, including "All")
    const fullHeaderLine = activeFilterLabel
      ? headerLine + getThemeColor('textSecondary')(' - ') + getThemeColor('primary')(activeFilterLabel)
      : headerLine
    // Pad to terminal width to clear any leftover characters
    const headerPadding = Math.max(0, terminalWidth - VersionUtils.getVisualLength(fullHeaderLine))
    output.push(fullHeaderLine + ' '.repeat(headerPadding))
  } else {
    const headerLine = '  ' + chalk.bold.blue('🚀 ') + chalk.bold.red('i') + chalk.bold.yellow('n') + chalk.bold.blue('u') + chalk.bold.magenta('p')

    // Show filter state (always show, including "All")
    const fullHeaderLine = activeFilterLabel
      ? headerLine + getThemeColor('textSecondary')(' - ') + getThemeColor('primary')(activeFilterLabel)
      : headerLine
    // Pad to terminal width to clear any leftover characters
    const headerPadding = Math.max(0, terminalWidth - VersionUtils.getVisualLength(fullHeaderLine))
    output.push(fullHeaderLine + ' '.repeat(headerPadding))
  }
  output.push('')

  if (filterMode) {
    // Show filter input with cursor when actively filtering
    const filterDisplay = '  ' + chalk.bold.white('Search: ') + getThemeColor('primary')(filterQuery || '') + getThemeColor('border')('█')
    // Pad to terminal width to clear any leftover characters from backspace
    const padding = Math.max(0, terminalWidth - VersionUtils.getVisualLength(filterDisplay))
    output.push(filterDisplay + ' '.repeat(padding))
  } else {
    // Show instructions when not filtering
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
      statusLine = getThemeColor('warning')(`No matches found`) +
        '  ' +
        getThemeColor('textSecondary')('Esc ') +
        getThemeColor('textSecondary')('Clear filter')
    } else if (totalVisualItems > maxVisibleItems) {
      statusLine = getThemeColor('textSecondary')(
        `Showing ${chalk.white(startItem)}-${chalk.white(endItem)} of ${chalk.white(totalPackages)} matches (${chalk.white(totalBeforeFilter)} total)`
      ) +
        '  ' +
        getThemeColor('textSecondary')('Esc ') +
        getThemeColor('textSecondary')('Clear filter')
    } else {
      statusLine = getThemeColor('textSecondary')(`Showing all ${chalk.white(totalPackages)} matches (${chalk.white(totalBeforeFilter)} total)`) +
        '  ' +
        getThemeColor('textSecondary')('Esc ') +
        getThemeColor('textSecondary')('Clear filter')
    }
  } else if (totalPackages < totalBeforeFilter) {
    // Filter is applied but not in filter mode
    if (totalVisualItems > maxVisibleItems) {
      statusLine = getThemeColor('textSecondary')(
        `Showing ${chalk.white(startItem)}-${chalk.white(endItem)} of ${chalk.white(totalPackages)} matches (${chalk.white(totalBeforeFilter)} total)`
      ) +
        '  ' +
        getThemeColor('textSecondary')('/ ') +
        getThemeColor('textSecondary')('Edit filter') +
        '  ' +
        getThemeColor('textSecondary')('Enter ') +
        getThemeColor('textSecondary')('Confirm') +
        '  ' +
        getThemeColor('textSecondary')('Esc ') +
        getThemeColor('textSecondary')('Cancel')
    } else {
      statusLine = getThemeColor('textSecondary')(`Showing all ${chalk.white(totalPackages)} matches (${chalk.white(totalBeforeFilter)} total)`) +
        '  ' +
        getThemeColor('textSecondary')('/ ') +
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
          item.originalIndex === currentRow,
          terminalWidth
        )
        output.push(line)
      }
    }
  } else {
    // Fallback to flat rendering (legacy mode)
    for (let i = scrollOffset; i < Math.min(scrollOffset + maxVisibleItems, states.length); i++) {
      const line = renderPackageLine(states[i], i, i === currentRow, terminalWidth)
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
