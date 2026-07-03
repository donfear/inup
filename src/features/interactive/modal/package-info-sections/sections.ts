import path from 'node:path'
import chalk from 'chalk'
import { PackageSelectionState } from '../../../../shared/types'
import { InfoModalTab, ModalSection } from '../types'
import { getThemeColor } from '../../themes-colors'
import {
  getVulnerabilityLinkLabel,
  getVulnerabilitySeverityColor,
  selectRepresentativeAdvisory,
} from '../../../audit'
import { getVisualLength, truncatePlainText, wrapPlainText } from '../../../../shared/terminal'
import { checkNodeEngineCompatibility } from '../../../../shared/engines'
import { buildReleaseNotesSections } from './release-notes'

function formatNumber(num: number | undefined): string {
  if (!num) return 'N/A'
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

function getUsedByPaths(state: PackageSelectionState): string[] {
  return state.packageJsonPaths ?? [state.packageJsonPath]
}

function buildTabBarSuffix(activeTab: InfoModalTab, usedByCount: number): string {
  const styleFor = (tab: InfoModalTab) => (tab === activeTab ? chalk.bold.underline : chalk.gray)
  const usedByLabel = `Used by${usedByCount > 0 ? ` (${usedByCount})` : ''}`
  return (
    '  ' +
    chalk.gray('[ ') +
    styleFor('info')('Info') +
    chalk.gray(' │ ') +
    styleFor('usedBy')(usedByLabel) +
    chalk.gray(' ]')
  )
}

export function buildUsedBySections(
  state: PackageSelectionState,
  modalWidth: number
): ModalSection[] {
  const paths = getUsedByPaths(state)
  const cwd = process.cwd()
  const contentWidth = Math.max(10, modalWidth - 4)
  const formatRelative = (absolutePath: string): string => {
    const display = path.relative(cwd, absolutePath) || absolutePath
    return truncatePlainText(display, contentWidth)
  }

  return [
    {
      key: 'used-by-summary',
      rows: [
        chalk.bold(
          `${paths.length} package.json file${paths.length === 1 ? '' : 's'} depend on ${state.name}`
        ),
        chalk.gray(`Type: ${state.type}`),
      ],
      required: true,
      behavior: 'pinned',
    },
    {
      key: 'used-by-list',
      rows: paths.map((p) => `${chalk.gray('•')} ${formatRelative(p)}`),
      behavior: 'body',
    },
  ]
}

export function buildPackageInfoSections(
  state: PackageSelectionState,
  modalWidth: number,
  activeTab: InfoModalTab
): ModalSection[] {
  const title =
    chalk.bold('Package: ') +
    getThemeColor('packageName')(state.name) +
    buildTabBarSuffix(activeTab, getUsedByPaths(state).length)
  const authorLicense = chalk.gray(`${state.author || 'Unknown'} • ${state.license || 'MIT'}`)
  const currentVersion = chalk.yellow(state.currentVersionSpecifier)
  const targetVersion = chalk.green(
    state.selectedOption === 'range' ? state.rangeVersion : state.latestVersion
  )

  const sections: ModalSection[] = [
    {
      key: 'header',
      rows: [title, authorLicense],
      required: true,
      behavior: 'pinned',
    },
  ]

  if (activeTab === 'usedBy') {
    sections.push(...buildUsedBySections(state, modalWidth))
    return sections
  }

  sections.push({
    key: 'meta',
    rows: [
      `Current: ${currentVersion}  Target: ${targetVersion}`,
      ...(state.weeklyDownloads !== undefined
        ? [getThemeColor('primary')(`Downloads/week: ${formatNumber(state.weeklyDownloads)}`)]
        : []),
    ],
    required: true,
    behavior: 'pinned',
  })

  const warningRows: string[] = []
  const warningContentWidth = Math.max(10, modalWidth - 4)
  if (state.deprecated) {
    // Wrap (don't truncate) so a deprecation URL stays whole and clickable —
    // truncation with "..." produces a dead link. `wrapPlainText` breaks on
    // spaces only, so the URL keeps its own intact line. No emoji marker:
    // terminal fonts disagree on whether such glyphs render one or two columns
    // wide, which throws off the modal's border alignment.
    for (const line of wrapPlainText(`Deprecated: ${state.deprecated}`, warningContentWidth)) {
      warningRows.push(getThemeColor('warning')(line))
    }
  }
  const engineWarning = checkNodeEngineCompatibility(state.enginesNode)
  if (engineWarning) {
    warningRows.push(getThemeColor('warning')(`Hold: ${engineWarning}`))
  }
  if (warningRows.length > 0) {
    sections.push({
      key: 'warnings',
      rows: warningRows,
      behavior: 'pinned',
    })
  }

  if (state.homepage) {
    sections.push({
      key: 'homepage',
      rows: [
        `Homepage: ${chalk.underline(getThemeColor('primary')(truncatePlainText(state.homepage, modalWidth - 14)))}`,
      ],
      behavior: 'pinned',
    })
  }

  if (state.description) {
    sections.push({
      key: 'description',
      rows: wrapPlainText(state.description, modalWidth - 4)
        .slice(0, 4)
        .map((line, index, rows) =>
          index === rows.length - 1 && rows.length === 4
            ? truncatePlainText(line, modalWidth - 4)
            : line
        ),
      behavior: 'pinned',
    })
  }

  if (state.vulnerability && state.vulnerability.count > 0) {
    const representative = selectRepresentativeAdvisory(state.vulnerability)
    const severityColor = getVulnerabilitySeverityColor(state.vulnerability.highestSeverity)
    const vulnerabilityRows = [
      chalk.red.bold(
        `${state.vulnerability.count} known vulnerabilit${state.vulnerability.count === 1 ? 'y' : 'ies'} (${severityColor(state.vulnerability.highestSeverity.toUpperCase())})`
      ),
    ]

    if (representative) {
      const severityLabel = ` ${severityColor(`[${representative.severity.toUpperCase()}]`)} `
      const availableTitleWidth = Math.max(0, modalWidth - 4 - getVisualLength(severityLabel))
      vulnerabilityRows.push(
        `${severityLabel}${truncatePlainText(representative.title, availableTitleWidth)}`
      )
    }

    const detailsUrl = state.vulnerability.detailsUrl || representative?.url
    if (detailsUrl) {
      const linkPrefix = ` ${getVulnerabilityLinkLabel(detailsUrl)} `
      const availableLinkWidth = Math.max(0, modalWidth - 4 - getVisualLength(linkPrefix))
      vulnerabilityRows.push(
        `${linkPrefix}${chalk.underline(getThemeColor('primary')(truncatePlainText(detailsUrl, availableLinkWidth)))}`
      )
    }

    if (state.vulnerability.count > 1) {
      vulnerabilityRows.push(chalk.gray(` ... and ${state.vulnerability.count - 1} more`))
    }

    sections.push({
      key: 'vulnerability',
      rows: vulnerabilityRows,
      required: true,
      behavior: 'pinned',
    })
  }

  if (state.repository) {
    sections.push({
      key: 'changelog',
      rows: [
        `Changelog: ${chalk.underline(getThemeColor('primary')(truncatePlainText(state.repository, modalWidth - 15)))}`,
      ],
      behavior: 'pinned',
    })
  }

  sections.push(...buildReleaseNotesSections(state, modalWidth))

  return sections
}
