import chalk from 'chalk'
import { PackageInfo, PackageSelectionState, VulnerabilityDisplayOptions } from '../../../types'
import { VersionUtils } from '../../utils'
import { getThemeColor } from '../../themes-colors'
import {
  getVulnerabilityBadge,
  shouldDisplayVulnerabilityForDependency,
} from '../../presenters/vulnerability'

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
    case 'dependencies':
    default:
      return ''
  }
}

export function renderPackageLine(
  state: PackageSelectionState,
  _index: number,
  isCurrentRow: boolean,
  terminalWidth: number = 80,
  options: PackageListRenderOptions = {},
  groupPosition?: 'middle' | 'last'
): string {
  const prefix = isCurrentRow ? getThemeColor('success')('❯ ') : '  '

  const isGrouped = groupPosition !== undefined
  const treeChar = groupPosition === 'last' ? '└ ' : groupPosition === 'middle' ? '├ ' : ''
  const treeDecor = isGrouped
    ? (isCurrentRow ? getThemeColor('success') : getThemeColor('packageAuthor'))(treeChar)
    : ''

  const displayedFullName = isGrouped
    ? state.name.slice(state.name.indexOf('/') + 1)
    : state.name

  let packageName
  if (!isGrouped && state.name.startsWith('@')) {
    const parts = state.name.split('/')
    if (parts.length >= 2) {
      const author = parts[0]
      const packagePart = parts.slice(1).join('/')

      if (isCurrentRow) {
        packageName =
          chalk.bold(getThemeColor('packageAuthor')(author)) +
          getThemeColor('packageName')('/' + packagePart)
      } else {
        packageName = chalk.bold.white(author) + chalk.white('/' + packagePart)
      }
    } else {
      packageName = isCurrentRow
        ? getThemeColor('packageName')(state.name)
        : chalk.white(state.name)
    }
  } else {
    packageName = isCurrentRow
      ? getThemeColor('packageName')(displayedFullName)
      : chalk.white(displayedFullName)
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

  const treeWidth = isGrouped ? 2 : 0
  const badgeWidth = state.type === 'dependencies' ? 0 : 3
  const truncatedName = VersionUtils.truncateMiddle(
    displayedFullName,
    packageNameWidth - 1 - badgeWidth - treeWidth
  )

  const shouldShowDashes = (paddingAmount: number): boolean => paddingAmount > 2

  const dashColor = isCurrentRow ? chalk.white : chalk.gray

  const displayName = truncatedName !== displayedFullName ? truncatedName : packageName

  const typeBadge = getTypeBadge(state.type)
  const shouldShowVulnerability = shouldDisplayVulnerabilityForDependency(state.type, options)
  const vulnBadge = shouldShowVulnerability ? getVulnerabilityBadge(state.vulnerability) : ''
  const vulnBadgeWidth = vulnBadge ? VersionUtils.getVisualLength(vulnBadge) + 1 : 0
  const nameLength = VersionUtils.getVisualLength(truncatedName)
  const namePadding = Math.max(
    0,
    packageNameWidth - nameLength - 1 - badgeWidth - vulnBadgeWidth - treeWidth
  )
  const nameDashes = shouldShowDashes(namePadding)
    ? dashColor('-').repeat(namePadding)
    : ' '.repeat(namePadding)

  const vulnSuffix = vulnBadge ? ` ${vulnBadge}` : ''
  const packageNameSection = typeBadge
    ? `${treeDecor}${displayName} ${nameDashes}${vulnSuffix}${typeBadge}`
    : `${treeDecor}${displayName} ${nameDashes}${vulnSuffix}`

  const currentSection = `${currentDot} ${currentVersion}`
  const currentSectionLength = VersionUtils.getVisualLength(currentSection) + 1
  const currentPadding = Math.max(0, currentColumnWidth - currentSectionLength)
  const currentPaddingText = shouldShowDashes(currentPadding)
    ? dashColor('-').repeat(currentPadding)
    : ' '.repeat(currentPadding)
  const currentWithPadding = currentSection + ' ' + currentPaddingText

  let rangeSection = ''
  if (isPending || isFailed || state.hasRangeUpdate) {
    rangeSection = `${rangeDot} ${rangeVersionText}`
    const rangeSectionLength = VersionUtils.getVisualLength(rangeSection) + 1
    const rangePadding = Math.max(0, rangeColumnWidth - rangeSectionLength)
    const rangePaddingText = shouldShowDashes(rangePadding)
      ? dashColor('-').repeat(rangePadding)
      : ' '.repeat(rangePadding)
    rangeSection += ' ' + rangePaddingText
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
    latestSection += ' ' + latestPaddingText
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
  return '  ' + colorFn.bold(title)
}

export interface GroupHeaderAggregate {
  total: number
  ready: number
  pending: number
  selectedNone: number
  selectedRange: number
  selectedLatest: number
  hasRangeAvailable: number
  hasMajorAvailable: number
  vulnerable: number
}

export function renderGroupHeader(
  scope: string,
  memberCount: number,
  isCurrentRow: boolean,
  collapsed: boolean,
  aggregate?: GroupHeaderAggregate
): string {
  const prefix = isCurrentRow ? getThemeColor('success')('❯ ') : '  '
  const arrow = collapsed ? '▸' : '▾'
  const arrowColored = isCurrentRow
    ? getThemeColor('success')(arrow)
    : getThemeColor('packageAuthor')(arrow)
  const scopeText = isCurrentRow
    ? chalk.bold(getThemeColor('packageAuthor')(scope))
    : chalk.bold(getThemeColor('packageAuthor')(scope))
  const count = getThemeColor('textSecondary')(`(${memberCount})`)

  let summary = ''
  if (aggregate) {
    const parts: string[] = []
    const selected =
      aggregate.selectedRange + aggregate.selectedLatest
    if (selected > 0) {
      parts.push(getThemeColor('success')(`✓ ${selected}/${aggregate.total} selected`))
    }
    if (aggregate.pending > 0) {
      parts.push(getThemeColor('textSecondary')(`${aggregate.pending} loading`))
    }
    const updatesAvailable = aggregate.hasRangeAvailable + aggregate.hasMajorAvailable
    if (updatesAvailable > 0 && selected === 0) {
      const rangeBit =
        aggregate.hasRangeAvailable > 0
          ? getThemeColor('versionRange')(`${aggregate.hasRangeAvailable} minor`)
          : ''
      const latestBit =
        aggregate.hasMajorAvailable > 0
          ? getThemeColor('versionLatest')(`${aggregate.hasMajorAvailable} major`)
          : ''
      const bits = [rangeBit, latestBit].filter(Boolean).join(getThemeColor('textSecondary')(' · '))
      if (bits) parts.push(bits)
    }
    if (aggregate.vulnerable > 0) {
      parts.push(getThemeColor('error')(`⚠ ${aggregate.vulnerable}`))
    }
    if (parts.length > 0) {
      summary = '  ' + parts.join(getThemeColor('textSecondary')('  ·  '))
    }
  }

  return `${prefix}${arrowColored} ${scopeText} ${count}${summary}`
}

export function renderSpacer(): string {
  return ''
}
