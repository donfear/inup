import chalk from 'chalk'
import { truncatePlainText } from '../../../../shared/terminal'
import type {
  CooldownRenderStatus,
  PackageInfo,
  PackageSelectionState,
  VulnerabilityDisplayOptions,
} from '../../../../shared/types'
import { getVulnerabilityBadge, shouldDisplayVulnerabilityForDependency } from '../../../audit'
import { getHealthBadge } from '../../presenters/health'
import { getThemeColor } from '../../themes-colors'
import { VersionUtils } from '../version-format'

export type PackageListRenderOptions = VulnerabilityDisplayOptions & {
  columnWidths?: VersionColumnWidths
  /**
   * Live cooldown status for the header, held by reference rather than copied.
   *
   * The session is mounted before scanning starts, so these numbers are still zero when
   * the first frame renders and only become true partway through the run. A snapshot
   * taken at mount time would stay zero for the whole session — the same reason
   * `loadingProgress` is a single mutable object the runner writes through.
   */
  cooldown?: CooldownRenderStatus
  /** The held rows are currently revealed (`c`), so the header must stop saying "not listed". */
  cooldownHeldShown?: boolean
}

export interface VersionColumnWidths {
  current: number
  range: number
  latest: number
}

/**
 * Session-owned column layout over an append-only sequence of rows.
 *
 * Measures each row once, when it first appears in `arrivals`, and keeps the
 * running maximum, so a frame during streaming costs O(new rows) rather than
 * O(all rows). Widths are taken over every row rather than the filtered view,
 * so toggling a filter never makes the columns jump. Re-fits only when a new
 * row widened a column or the terminal width changed.
 */
export class VersionColumnLayout {
  private readonly need = initialColumnNeed()
  private measured = 0
  private cached?: { terminalWidth: number; need: VersionColumnWidths; widths: VersionColumnWidths }

  get(arrivals: readonly PackageSelectionState[], terminalWidth: number): VersionColumnWidths {
    for (; this.measured < arrivals.length; this.measured++) {
      measureVersionColumns(arrivals[this.measured], this.need)
    }
    const previous = this.cached
    if (
      previous &&
      previous.terminalWidth === terminalWidth &&
      previous.need.current === this.need.current &&
      previous.need.range === this.need.range &&
      previous.need.latest === this.need.latest
    ) {
      return previous.widths
    }
    const widths = fitVersionColumns(this.need, terminalWidth)
    this.cached = { terminalWidth, need: { ...this.need }, widths }
    return widths
  }
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
const VERSION_COLUMNS = ['current', 'range', 'latest'] as const

// The narrowest terminal the classic row fits: name at its minimum, the three
// version columns at 16 and three-space gaps, ending one column short of the
// edge. Narrower terminals squeeze the row rather than let it wrap: first the
// gaps close to a single space, then the version columns give up their dash
// padding down to MIN_SQUEEZED_VERSION_COLUMN_WIDTH (still room for ^1.10.0).
// That reaches 60 columns with every section intact; past it, padLineToWidth
// cuts the row off at the edge.
const CLASSIC_ROW_WIDTH =
  PREFIX_WIDTH + MIN_PACKAGE_NAME_WIDTH + (MIN_VERSION_COLUMN_WIDTH + SPACING_WIDTH) * 3 + 1
const MIN_SPACING_WIDTH = 1
const MIN_SQUEEZED_VERSION_COLUMN_WIDTH = 10
const MAX_GAP_SQUEEZE = (SPACING_WIDTH - MIN_SPACING_WIDTH) * 3
const MAX_COLUMN_SQUEEZE = (MIN_VERSION_COLUMN_WIDTH - MIN_SQUEEZED_VERSION_COLUMN_WIDTH) * 3

/** Gaps after the name, current and range sections, closing one space at a time from the right. */
function sectionGaps(terminalWidth: number): string[] {
  const gaps = [SPACING_WIDTH, SPACING_WIDTH, SPACING_WIDTH]
  const squeeze = Math.min(CLASSIC_ROW_WIDTH - terminalWidth, MAX_GAP_SQUEEZE)
  for (let i = 0; i < squeeze; i++) gaps[2 - (i % 3)]--
  return gaps.map((gap) => ' '.repeat(gap))
}

/**
 * Size the three version columns for a render pass. Columns start at the
 * classic 16 and grow — only as far as the terminal allows after the package
 * name keeps its minimum — to fit the longest version on screen (prerelease
 * specs like ^16.0.0-preview.10 overflow 16); a terminal too narrow for the
 * classic row shrinks them instead (see CLASSIC_ROW_WIDTH). Computed over ALL
 * states, not just the visible window, so columns never shift while
 * scrolling. Versions that still do not fit are middle-truncated by
 * renderPackageLine.
 */
export function computeVersionColumnWidths(
  states: PackageSelectionState[],
  terminalWidth: number
): VersionColumnWidths {
  const need = initialColumnNeed()
  for (const state of states) measureVersionColumns(state, need)
  return fitVersionColumns(need, terminalWidth)
}

function initialColumnNeed(): VersionColumnWidths {
  return {
    current: MIN_VERSION_COLUMN_WIDTH,
    range: MIN_VERSION_COLUMN_WIDTH,
    latest: MIN_VERSION_COLUMN_WIDTH,
  }
}

/** Grows `need` to fit one row's versions (capped at the maximum column width). */
function measureVersionColumns(state: PackageSelectionState, need: VersionColumnWidths): void {
  const cap = (value: number) => Math.min(value, MAX_VERSION_COLUMN_WIDTH)
  need.current = cap(
    Math.max(
      need.current,
      VersionUtils.getVisualLength(state.currentVersionSpecifier) + VERSION_COLUMN_OVERHEAD
    )
  )
  if (state.hasRangeUpdate) {
    const range = VersionUtils.applyVersionPrefix(state.currentVersionSpecifier, state.rangeVersion)
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

/**
 * Fits the needed widths into the terminal, growing columns round-robin from
 * the classic size — or, below the classic row width, shrinking them
 * round-robin once the gaps have closed (see CLASSIC_ROW_WIDTH).
 */
function fitVersionColumns(need: VersionColumnWidths, terminalWidth: number): VersionColumnWidths {
  const widths: VersionColumnWidths = {
    current: MIN_VERSION_COLUMN_WIDTH,
    range: MIN_VERSION_COLUMN_WIDTH,
    latest: MIN_VERSION_COLUMN_WIDTH,
  }
  const squeeze = Math.min(CLASSIC_ROW_WIDTH - terminalWidth - MAX_GAP_SQUEEZE, MAX_COLUMN_SQUEEZE)
  for (let i = 0; i < squeeze; i++) widths[VERSION_COLUMNS[i % 3]]--
  // Growth budget: whatever the terminal has beyond the classic row. Wider
  // columns come out of the name's share — it already middle-truncates long
  // names gracefully.
  let pool = Math.max(0, terminalWidth - CLASSIC_ROW_WIDTH)
  // Round-robin growth keeps the distribution fair when the pool runs short.
  let grew = true
  while (pool > 0 && grew) {
    grew = false
    for (const key of VERSION_COLUMNS) {
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
  const width = VersionUtils.getVisualLength(line)
  if (width <= terminalWidth) return line + ' '.repeat(terminalWidth - width)
  // Last resort: a line wider than the terminal wraps, and the session writes
  // changed rows by absolute position, so every later update would land one
  // row off. Cut it at the edge instead.
  const cut = truncatePlainText(line, terminalWidth)
  return cut + ' '.repeat(Math.max(0, terminalWidth - VersionUtils.getVisualLength(cut)))
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

  const widths = columnWidths ?? fitVersionColumns(initialColumnNeed(), terminalWidth)
  const currentColumnWidth = widths.current
  const rangeColumnWidth = widths.range
  const latestColumnWidth = widths.latest
  const [nameGap, currentGap, rangeGap] = sectionGaps(terminalWidth)

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
  if (state.hasRangeUpdate) {
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
  if (state.hasMajorUpdate) {
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
    currentColumnWidth +
    rangeColumnWidth +
    latestColumnWidth +
    nameGap.length +
    currentGap.length +
    rangeGap.length
  const availableForPackageName = terminalWidth - PREFIX_WIDTH - otherColumnsWidth - 1
  const packageNameWidth = Math.min(
    MAX_PACKAGE_NAME_WIDTH,
    Math.max(MIN_PACKAGE_NAME_WIDTH, availableForPackageName)
  )

  // Trailing badges each occupy 3 columns: the dep-type marker ([D]/[P]/[O])
  // and the pnpm-catalog marker ([C]); both may be present at once.
  const badgeWidth = (state.type === 'dependencies' ? 0 : 3) + (state.catalog ? 3 : 0)
  const typeBadge = getTypeBadge(state.type)
  const shouldShowVulnerability = shouldDisplayVulnerabilityForDependency(state.type, options)
  const vulnBadge = shouldShowVulnerability ? getVulnerabilityBadge(state.vulnerability) : ''
  const vulnBadgeWidth = vulnBadge ? VersionUtils.getVisualLength(vulnBadge) + 1 : 0
  // Deprecation / engines-incompatibility marker (independent of dep type).
  const healthBadge = getHealthBadge(state)
  const healthBadgeWidth = healthBadge ? VersionUtils.getVisualLength(healthBadge) + 1 : 0

  // The name budget must leave room for EVERY badge in the section —
  // vulnerability and health markers included — or a saturated name pushes
  // them past the column and the whole row overflows and wraps the frame.
  const truncatedName = VersionUtils.truncateMiddle(
    state.name,
    packageNameWidth - 1 - badgeWidth - vulnBadgeWidth - healthBadgeWidth
  )

  const shouldShowDashes = (paddingAmount: number): boolean => paddingAmount > 2

  const dashColor = isCurrentRow ? chalk.white : chalk.gray

  const displayName = truncatedName !== state.name ? truncatedName : packageName

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
  if (state.hasRangeUpdate) {
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
  if (state.hasMajorUpdate) {
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

  return `${prefix}${packageNameSection}${nameGap}${currentWithPadding}${currentGap}${rangeSection}${rangeGap}${latestSection}`
}
