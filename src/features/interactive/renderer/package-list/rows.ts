import chalk from 'chalk'
import type {
  PackageInfo,
  PackageSelectionState,
  VulnerabilityDisplayOptions,
} from '../../../../shared/types'
import { getVulnerabilityBadge, shouldDisplayVulnerabilityForDependency } from '../../../audit'
import { getHealthBadge } from '../../presenters/health'
import { getThemeColor } from '../../themes-colors'
import { VersionUtils } from '../version-format'

export type PackageListRenderOptions = VulnerabilityDisplayOptions

export interface VersionColumnWidths {
  current: number
  range: number
  latest: number
}

// Version column layout: dot + space + version + trailing space. The overhead
// is what a column needs beyond the version text itself.
const VERSION_COLUMN_OVERHEAD = 3
const MIN_VERSION_COLUMN_WIDTH = 16
const MAX_VERSION_COLUMN_WIDTH = 24
const PREFIX_WIDTH = 2
const SPACING_WIDTH = 3
const MIN_PACKAGE_NAME_WIDTH = 24
const MAX_PACKAGE_NAME_WIDTH = 50

/**
 * Size the three version columns for a render pass. Columns start at the
 * classic 16 and grow — only as far as the terminal allows after the package
 * name keeps its minimum — to fit the longest version on screen (prerelease
 * specs like ^16.0.0-preview.10 overflow 16). Computed over ALL states, not
 * just the visible window, so columns never shift while scrolling. Versions
 * that still do not fit are middle-truncated by renderPackageLine.
 */
export function computeVersionColumnWidths(
  states: PackageSelectionState[],
  terminalWidth: number
): VersionColumnWidths {
  const need: VersionColumnWidths = {
    current: MIN_VERSION_COLUMN_WIDTH,
    range: MIN_VERSION_COLUMN_WIDTH,
    latest: MIN_VERSION_COLUMN_WIDTH,
  }
  for (const state of states) {
    const cap = (value: number) => Math.min(value, MAX_VERSION_COLUMN_WIDTH)
    need.current = cap(
      Math.max(
        need.current,
        VersionUtils.getVisualLength(state.currentVersionSpecifier) + VERSION_COLUMN_OVERHEAD
      )
    )
    if (state.loadState !== 'ready') continue
    if (state.hasRangeUpdate) {
      const range = VersionUtils.applyVersionPrefix(
        state.currentVersionSpecifier,
        state.rangeVersion
      )
      need.range = cap(
        Math.max(need.range, VersionUtils.getVisualLength(range) + VERSION_COLUMN_OVERHEAD)
      )
    }
    if (state.hasMajorUpdate) {
      const latest = VersionUtils.applyVersionPrefix(
        state.currentVersionSpecifier,
        state.latestVersion
      )
      need.latest = cap(
        Math.max(need.latest, VersionUtils.getVisualLength(latest) + VERSION_COLUMN_OVERHEAD)
      )
    }
  }

  // Growth budget: whatever remains once the package name keeps its minimum
  // width at the classic column sizes. The name column absorbs the squeeze —
  // it already middle-truncates long names gracefully.
  let pool = Math.max(
    0,
    terminalWidth -
      PREFIX_WIDTH -
      1 -
      MIN_PACKAGE_NAME_WIDTH -
      (MIN_VERSION_COLUMN_WIDTH * 3 + SPACING_WIDTH * 3)
  )
  const widths: VersionColumnWidths = {
    current: MIN_VERSION_COLUMN_WIDTH,
    range: MIN_VERSION_COLUMN_WIDTH,
    latest: MIN_VERSION_COLUMN_WIDTH,
  }
  // Round-robin growth keeps the distribution fair when the pool runs short.
  let grew = true
  while (pool > 0 && grew) {
    grew = false
    for (const key of ['current', 'range', 'latest'] as const) {
      if (pool > 0 && widths[key] < need[key]) {
        widths[key]++
        pool--
        grew = true
      }
    }
  }
  return widths
}

export function padLineToWidth(line: string, terminalWidth: number): string {
  const padding = Math.max(0, terminalWidth - VersionUtils.getVisualLength(line))
  return line + ' '.repeat(padding)
}

function getTypeBadge(type: PackageInfo['type']): string {
  switch (type) {
    case 'devDependencies':
      return getThemeColor('textSecondary')('[D]')
    case 'peerDependencies':
      return getThemeColor('textSecondary')('[P]')
    case 'optionalDependencies':
      return getThemeColor('textSecondary')('[O]')
    default:
      return ''
  }
}

/** Marks entries whose range lives in a pnpm catalog (pnpm-workspace.yaml), not a package.json. */
function getCatalogBadge(catalog: string | undefined): string {
  return catalog ? getThemeColor('textSecondary')('[C]') : ''
}

export function renderPackageLine(
  state: PackageSelectionState,
  _index: number,
  isCurrentRow: boolean,
  terminalWidth: number = 80,
  options: PackageListRenderOptions = {},
  columnWidths?: VersionColumnWidths
): string {
  const prefix = isCurrentRow ? getThemeColor('success')('❯ ') : '  '

  let packageName: string
  if (state.name.startsWith('@')) {
    const parts = state.name.split('/')
    if (parts.length >= 2) {
      const author = parts[0]
      const packagePart = parts.slice(1).join('/')

      if (isCurrentRow) {
        // Accent the package, not the scope: `@tiptap/` repeats down the list
        // and carries no signal, so it stays dim while the distinguishing name
        // (`extension-image`) takes the theme accent, bold.
        packageName =
          getThemeColor('textSecondary')(`${author}/`) +
          chalk.bold(getThemeColor('packageName')(packagePart))
      } else {
        // Same emphasis at rest: the scope is context (dim), the package name
        // is what you read (plain text). The current row only brightens the
        // name to the accent — it never flips which token stands out.
        packageName = getThemeColor('textSecondary')(`${author}/`) + chalk.white(packagePart)
      }
    } else {
      packageName = isCurrentRow
        ? getThemeColor('packageName')(state.name)
        : chalk.white(state.name)
    }
  } else {
    packageName = isCurrentRow ? getThemeColor('packageName')(state.name) : chalk.white(state.name)
  }

  const isCurrentSelected = state.selectedOption === 'none'
  const isRangeSelected = state.selectedOption === 'range'
  const isLatestSelected = state.selectedOption === 'latest'
  const isPending = state.loadState === 'pending'
  const isFailed = state.loadState === 'failed'

  const currentColumnWidth = columnWidths?.current ?? MIN_VERSION_COLUMN_WIDTH
  const rangeColumnWidth = columnWidths?.range ?? MIN_VERSION_COLUMN_WIDTH
  const latestColumnWidth = columnWidths?.latest ?? MIN_VERSION_COLUMN_WIDTH

  // A version that outgrows its column is middle-truncated: both ends carry
  // the signal (^16.0.0-preview.10 → ^16.0.…eview.10), and a fixed row width
  // is what keeps the frame from wrapping. Truncate the raw string before
  // coloring — truncateMiddle strips ANSI codes.
  const fitColumn = (version: string, columnWidth: number): string =>
    VersionUtils.truncateMiddle(version, columnWidth - VERSION_COLUMN_OVERHEAD)

  const currentDot = isCurrentSelected ? getThemeColor('dot')('●') : getThemeColor('dotEmpty')('○')
  const currentVersion = chalk.white(fitColumn(state.currentVersionSpecifier, currentColumnWidth))

  let rangeDot = ''
  let rangeVersionText = ''
  if (isPending) {
    rangeDot = getThemeColor('dotEmpty')('◌')
    rangeVersionText = chalk.gray('loading')
  } else if (isFailed) {
    rangeDot = getThemeColor('dotEmpty')('◌')
    rangeVersionText = chalk.gray('unavailable')
  } else if (state.hasRangeUpdate) {
    rangeDot = isRangeSelected ? getThemeColor('dot')('●') : getThemeColor('dotEmpty')('○')
    const rangeVersionWithPrefix = VersionUtils.applyVersionPrefix(
      state.currentVersionSpecifier,
      state.rangeVersion
    )
    rangeVersionText = getThemeColor('versionRange')(
      fitColumn(rangeVersionWithPrefix, rangeColumnWidth)
    )
  } else {
    rangeDot = getThemeColor('dotEmpty')('○')
    rangeVersionText = ''
  }

  let latestDot = ''
  let latestVersionText = ''
  if (isPending) {
    latestDot = getThemeColor('dotEmpty')('◌')
    latestVersionText = chalk.gray('loading')
  } else if (isFailed) {
    latestDot = getThemeColor('dotEmpty')('◌')
    latestVersionText = chalk.gray('unavailable')
  } else if (state.hasMajorUpdate) {
    latestDot = isLatestSelected ? getThemeColor('dot')('●') : getThemeColor('dotEmpty')('○')
    const latestVersionWithPrefix = VersionUtils.applyVersionPrefix(
      state.currentVersionSpecifier,
      state.latestVersion
    )
    latestVersionText = getThemeColor('versionLatest')(
      fitColumn(latestVersionWithPrefix, latestColumnWidth)
    )
  } else {
    latestDot = getThemeColor('dotEmpty')('○')
    latestVersionText = ''
  }

  const otherColumnsWidth =
    currentColumnWidth + rangeColumnWidth + latestColumnWidth + SPACING_WIDTH * 3
  const availableForPackageName = terminalWidth - PREFIX_WIDTH - otherColumnsWidth - 1
  const packageNameWidth = Math.min(
    MAX_PACKAGE_NAME_WIDTH,
    Math.max(MIN_PACKAGE_NAME_WIDTH, availableForPackageName)
  )

  // Trailing badges each occupy 3 columns: the dep-type marker ([D]/[P]/[O])
  // and the pnpm-catalog marker ([C]); both may be present at once.
  const badgeWidth = (state.type === 'dependencies' ? 0 : 3) + (state.catalog ? 3 : 0)
  const truncatedName = VersionUtils.truncateMiddle(state.name, packageNameWidth - 1 - badgeWidth)

  const shouldShowDashes = (paddingAmount: number): boolean => paddingAmount > 2

  const dashColor = isCurrentRow ? chalk.white : chalk.gray

  const displayName = truncatedName !== state.name ? truncatedName : packageName

  const typeBadge = getTypeBadge(state.type)
  const shouldShowVulnerability = shouldDisplayVulnerabilityForDependency(state.type, options)
  const vulnBadge = shouldShowVulnerability ? getVulnerabilityBadge(state.vulnerability) : ''
  const vulnBadgeWidth = vulnBadge ? VersionUtils.getVisualLength(vulnBadge) + 1 : 0
  // Deprecation / engines-incompatibility marker (independent of dep type).
  const healthBadge = getHealthBadge(state)
  const healthBadgeWidth = healthBadge ? VersionUtils.getVisualLength(healthBadge) + 1 : 0
  const nameLength = VersionUtils.getVisualLength(truncatedName)
  const namePadding = Math.max(
    0,
    packageNameWidth - nameLength - 1 - badgeWidth - vulnBadgeWidth - healthBadgeWidth
  )
  const nameDashes = shouldShowDashes(namePadding)
    ? dashColor('-').repeat(namePadding)
    : ' '.repeat(namePadding)

  const vulnSuffix = vulnBadge ? ` ${vulnBadge}` : ''
  const healthSuffix = healthBadge ? ` ${healthBadge}` : ''
  const trailingBadges = `${getCatalogBadge(state.catalog)}${typeBadge}`
  const packageNameSection = trailingBadges
    ? `${displayName} ${nameDashes}${vulnSuffix}${healthSuffix}${trailingBadges}`
    : `${displayName} ${nameDashes}${vulnSuffix}${healthSuffix}`

  const currentSection = `${currentDot} ${currentVersion}`
  const currentSectionLength = VersionUtils.getVisualLength(currentSection) + 1
  const currentPadding = Math.max(0, currentColumnWidth - currentSectionLength)
  const currentPaddingText = shouldShowDashes(currentPadding)
    ? dashColor('-').repeat(currentPadding)
    : ' '.repeat(currentPadding)
  const currentWithPadding = `${currentSection} ${currentPaddingText}`

  let rangeSection = ''
  if (isPending || isFailed || state.hasRangeUpdate) {
    rangeSection = `${rangeDot} ${rangeVersionText}`
    const rangeSectionLength = VersionUtils.getVisualLength(rangeSection) + 1
    const rangePadding = Math.max(0, rangeColumnWidth - rangeSectionLength)
    const rangePaddingText = shouldShowDashes(rangePadding)
      ? dashColor('-').repeat(rangePadding)
      : ' '.repeat(rangePadding)
    rangeSection += ` ${rangePaddingText}`
  } else {
    rangeSection = ' '.repeat(rangeColumnWidth)
  }

  let latestSection = ''
  if (isPending || isFailed || state.hasMajorUpdate) {
    latestSection = `${latestDot} ${latestVersionText}`
    const latestSectionLength = VersionUtils.getVisualLength(latestSection) + 1
    const latestPadding = Math.max(0, latestColumnWidth - latestSectionLength)
    const latestPaddingText = shouldShowDashes(latestPadding)
      ? dashColor('-').repeat(latestPadding)
      : ' '.repeat(latestPadding)
    latestSection += ` ${latestPaddingText}`
  } else {
    latestSection = ' '.repeat(latestColumnWidth)
  }

  return `${prefix}${packageNameSection}   ${currentWithPadding}   ${rangeSection}   ${latestSection}`
}

export function renderSectionHeader(
  title: string,
  sectionType: 'main' | 'peer' | 'optional'
): string {
  const colorFn =
    sectionType === 'main' ? chalk.cyan : sectionType === 'peer' ? chalk.magenta : chalk.yellow
  return `  ${colorFn.bold(title)}`
}

export function renderSpacer(): string {
  return ''
}
