import chalk from 'chalk'
import { PackageSelectionState } from '../../types'
import { ModalSection } from './types'
import { getThemeColor } from '../themes-colors'
import {
  getVulnerabilityLinkLabel,
  getVulnerabilitySeverityColor,
  selectRepresentativeAdvisory,
} from '../presenters/vulnerability'
import { truncatePlainText, wrapPlainText } from '../utils'

function formatNumber(num: number | undefined): string {
  if (!num) return 'N/A'
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

export function buildPackageInfoSections(
  state: PackageSelectionState,
  modalWidth: number
): ModalSection[] {
  const title = chalk.cyan.bold(` ℹ️  ${state.name}`)
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
    },
    {
      key: 'meta',
      rows: [
        `Current: ${currentVersion} → Target: ${targetVersion}`,
        ...(state.weeklyDownloads !== undefined
          ? [getThemeColor('primary')(`📊 ${formatNumber(state.weeklyDownloads)} downloads/week`)]
          : []),
      ],
      required: true,
    },
  ]

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
    })
  }

  if (state.vulnerability && state.vulnerability.count > 0) {
    const representative = selectRepresentativeAdvisory(state.vulnerability)
    const severityColor = getVulnerabilitySeverityColor(state.vulnerability.highestSeverity)
    const vulnerabilityRows = [
      chalk.red.bold(
        `⚠ ${state.vulnerability.count} known vulnerabilit${state.vulnerability.count === 1 ? 'y' : 'ies'} (${severityColor(state.vulnerability.highestSeverity.toUpperCase())})`
      ),
    ]

    if (representative) {
      vulnerabilityRows.push(
        ` ${severityColor(`[${representative.severity.toUpperCase()}]`)} ${truncatePlainText(representative.title, modalWidth - 14)}`
      )
    }

    const detailsUrl = state.vulnerability.detailsUrl || representative?.url
    if (detailsUrl) {
      vulnerabilityRows.push(
        ` ${getVulnerabilityLinkLabel(detailsUrl)} ${chalk.underline(getThemeColor('primary')(truncatePlainText(detailsUrl, modalWidth - 14)))}`
      )
    }

    if (state.vulnerability.count > 1) {
      vulnerabilityRows.push(chalk.gray(` ... and ${state.vulnerability.count - 1} more`))
    }

    sections.push({
      key: 'vulnerability',
      rows: vulnerabilityRows,
      required: true,
    })
  }

  if (state.repository) {
    sections.push({
      key: 'changelog',
      rows: [
        `Changelog: ${chalk.underline(getThemeColor('primary')(truncatePlainText(state.repository, modalWidth - 15)))}`,
      ],
    })
  }

  if (state.homepage) {
    sections.push({
      key: 'homepage',
      rows: [
        `Homepage: ${chalk.underline(getThemeColor('primary')(truncatePlainText(state.homepage, modalWidth - 14)))}`,
      ],
    })
  }

  return sections
}
