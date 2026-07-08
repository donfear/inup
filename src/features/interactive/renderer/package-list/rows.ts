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
  options: PackageListRenderOptions = {}
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

  const currentDot = isCurrentSelected ? getThemeColor('dot')('●') : getThemeColor('dotEmpty')('○')
  const currentVersion = chalk.white(state.currentVersionSpecifier)

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
    rangeVersionText = getThemeColor('versionRange')(rangeVersionWithPrefix)
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
    latestVersionText = getThemeColor('versionLatest')(latestVersionWithPrefix)
  } else {
    latestDot = getThemeColor('dotEmpty')('○')
    latestVersionText = ''
  }

  const currentColumnWidth = 16
  const rangeColumnWidth = 16
  const latestColumnWidth = 16
  const spacingWidth = 3

  const maxPackageNameWidth = 50
  const minPackageNameWidth = 24
  const otherColumnsWidth =
    currentColumnWidth + rangeColumnWidth + latestColumnWidth + spacingWidth * 3
  const prefixWidth = 2
  const availableForPackageName = terminalWidth - prefixWidth - otherColumnsWidth - 1
  const packageNameWidth = Math.min(
    maxPackageNameWidth,
    Math.max(minPackageNameWidth, availableForPackageName)
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
