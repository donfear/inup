import chalk from 'chalk'
import { PackageSelectionState, VulnerabilitySummary } from '../../types'
import { getThemeColor } from '../themes-colors'
import { VersionUtils } from '../utils'

const stripAnsi = VersionUtils.stripAnsi

function formatNumber(num: number | undefined): string {
  if (!num) return 'N/A'
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

function wrapText(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) {
    return [text]
  }

  const lines: string[] = []
  let current = ''
  const words = text.split(' ')

  for (const word of words) {
    if ((current + ' ' + word).length > maxWidth) {
      if (current) lines.push(current)
      current = word
    } else {
      current = current ? current + ' ' + word : word
    }
  }

  if (current) {
    lines.push(current)
  }

  return lines
}

function renderModalRow(padding: number, modalWidth: number, text: string): string {
  const rowLength = stripAnsi(text).length
  const rowPadding = Math.max(0, modalWidth - 3 - rowLength)
  return (
    ' '.repeat(padding) + chalk.gray('│') + ' ' + text + ' '.repeat(rowPadding) + chalk.gray('│')
  )
}

function renderSeparator(padding: number, modalWidth: number): string {
  return ' '.repeat(padding) + chalk.gray('├' + '─'.repeat(modalWidth - 2) + '┤')
}

function truncatePlainText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) {
    return text
  }

  return text.substring(0, Math.max(0, maxWidth - 3)) + '...'
}

function getSeverityColor(
  severity: VulnerabilitySummary['highestSeverity']
): (text: string) => string {
  switch (severity) {
    case 'critical':
      return chalk.bgRed.white.bold
    case 'high':
      return chalk.red.bold
    case 'moderate':
      return chalk.yellow
    case 'low':
    case 'info':
    default:
      return chalk.gray
  }
}

function selectRepresentativeAdvisory(
  vulnerability: VulnerabilitySummary
): VulnerabilitySummary['advisories'][number] | undefined {
  return vulnerability.advisories[0]
}

function buildDescriptionSection(
  state: PackageSelectionState,
  modalWidth: number,
  maxLines: number
): string[] {
  if (!state.description || maxLines <= 0) {
    return []
  }

  const wrapped = wrapText(state.description, modalWidth - 4)
  return wrapped.slice(0, maxLines).map((line, index) => {
    if (index === maxLines - 1 && wrapped.length > maxLines) {
      return truncatePlainText(line, modalWidth - 4)
    }
    return line
  })
}

function buildVulnerabilitySection(state: PackageSelectionState, modalWidth: number): string[] {
  if (!state.vulnerability || state.vulnerability.count === 0) {
    return []
  }

  const representative = selectRepresentativeAdvisory(state.vulnerability)
  const severityColor = getSeverityColor(state.vulnerability.highestSeverity)
  const rows: string[] = []

  rows.push(
    chalk.red.bold(
      `⚠ ${state.vulnerability.count} known vulnerabilit${state.vulnerability.count === 1 ? 'y' : 'ies'} (${severityColor(state.vulnerability.highestSeverity.toUpperCase())})`
    )
  )

  if (representative) {
    const label = severityColor(`[${representative.severity.toUpperCase()}]`)
    const title = truncatePlainText(representative.title, modalWidth - 14)
    rows.push(` ${label} ${title}`)
  }

  const detailsUrl = state.vulnerability.detailsUrl || representative?.url
  if (detailsUrl) {
    const linkLabel = detailsUrl.includes('/advisories') ? 'Security:' : 'Details:'
    const link = truncatePlainText(detailsUrl, modalWidth - 14)
    rows.push(` ${linkLabel} ${chalk.underline(getThemeColor('primary')(link))}`)
  }

  if (state.vulnerability.count > 1) {
    rows.push(chalk.gray(` ... and ${state.vulnerability.count - 1} more`))
  }

  return rows
}

function fitSections(
  sections: Array<{ key: string; rows: string[]; required: boolean }>,
  maxHeight: number
): Array<{ key: string; rows: string[]; required: boolean }> {
  const totalLines = () =>
    2 +
    sections
      .filter((section) => section.rows.length > 0)
      .reduce((sum, section, index, active) => {
        return (
          sum +
          section.rows.length +
          (active.filter((item) => item.rows.length > 0)[0] === section ? 0 : 1)
        )
      }, 0)

  while (totalLines() > maxHeight) {
    const homepage = sections.find(
      (section) => section.key === 'homepage' && section.rows.length > 0 && !section.required
    )
    if (homepage) {
      homepage.rows = []
      continue
    }

    const changelog = sections.find(
      (section) => section.key === 'changelog' && section.rows.length > 0 && !section.required
    )
    if (changelog) {
      changelog.rows = []
      continue
    }

    const description = sections.find(
      (section) => section.key === 'description' && section.rows.length > 0 && !section.required
    )
    if (description) {
      description.rows = description.rows.slice(0, -1)
      continue
    }

    const meta = sections.find((section) => section.key === 'meta' && section.rows.length > 1)
    if (meta) {
      meta.rows = meta.rows.slice(0, 1)
      continue
    }

    break
  }

  return sections.filter((section) => section.rows.length > 0)
}

export function renderPackageInfoLoading(
  state: PackageSelectionState,
  terminalWidth: number = 80,
  terminalHeight: number = 24
): string[] {
  const modalWidth = Math.min(Math.max(50, terminalWidth - 6), 120)
  const padding = Math.floor((terminalWidth - modalWidth) / 2)
  const modalHeight = 4
  const topPadding = Math.max(1, Math.floor((terminalHeight - modalHeight) / 2))
  const lines: string[] = []

  for (let i = 0; i < topPadding; i++) {
    lines.push('')
  }

  lines.push(' '.repeat(padding) + chalk.gray('╭' + '─'.repeat(modalWidth - 2) + '╮'))
  lines.push(renderModalRow(padding, modalWidth, chalk.cyan('⏳ Loading package info...')))
  lines.push(renderModalRow(padding, modalWidth, chalk.white(state.name)))
  lines.push(' '.repeat(padding) + chalk.gray('╰' + '─'.repeat(modalWidth - 2) + '╯'))

  return lines
}

export function renderPackageInfoModal(
  state: PackageSelectionState,
  terminalWidth: number = 80,
  terminalHeight: number = 24
): string[] {
  const modalWidth = Math.min(Math.max(60, terminalWidth - 6), 120)
  const padding = Math.floor((terminalWidth - modalWidth) / 2)
  const maxModalHeight = Math.max(10, terminalHeight - 2)

  const title = chalk.cyan.bold(` ℹ️  ${state.name}`)
  const authorLicense = chalk.gray(`${state.author || 'Unknown'} • ${state.license || 'MIT'}`)
  const currentVersion = chalk.yellow(state.currentVersionSpecifier)
  const targetVersion = chalk.green(
    state.selectedOption === 'range' ? state.rangeVersion : state.latestVersion
  )

  const metaRows = [`Current: ${currentVersion} → Target: ${targetVersion}`]
  if (state.weeklyDownloads !== undefined) {
    metaRows.push(
      getThemeColor('primary')(`📊 ${formatNumber(state.weeklyDownloads)} downloads/week`)
    )
  }

  const descriptionRows = buildDescriptionSection(state, modalWidth, 4)
  const vulnerabilityRows = buildVulnerabilitySection(state, modalWidth)
  const changelogRows = state.repository
    ? [
        `Changelog: ${chalk.underline(getThemeColor('primary')(truncatePlainText(state.repository, modalWidth - 15)))}`,
      ]
    : []
  const homepageRows = state.homepage
    ? [
        `Homepage: ${chalk.underline(getThemeColor('primary')(truncatePlainText(state.homepage, modalWidth - 14)))}`,
      ]
    : []

  const sections = fitSections(
    [
      { key: 'header', rows: [title, authorLicense], required: true },
      { key: 'meta', rows: metaRows, required: true },
      { key: 'description', rows: descriptionRows, required: false },
      { key: 'vulnerability', rows: vulnerabilityRows, required: vulnerabilityRows.length > 0 },
      { key: 'changelog', rows: changelogRows, required: false },
      { key: 'homepage', rows: homepageRows, required: false },
    ],
    maxModalHeight
  )

  const lines: string[] = []
  const contentHeight =
    2 +
    sections.reduce((sum, section, index) => sum + section.rows.length + (index === 0 ? 0 : 1), 0)
  const topPadding = Math.max(1, Math.floor((terminalHeight - contentHeight) / 2))

  for (let i = 0; i < topPadding; i++) {
    lines.push('')
  }

  lines.push(' '.repeat(padding) + chalk.gray('╭' + '─'.repeat(modalWidth - 2) + '╮'))

  sections.forEach((section, index) => {
    if (index > 0) {
      lines.push(renderSeparator(padding, modalWidth))
    }

    section.rows.forEach((row) => {
      lines.push(renderModalRow(padding, modalWidth, row))
    })
  })

  lines.push(' '.repeat(padding) + chalk.gray('╰' + '─'.repeat(modalWidth - 2) + '╯'))
  return lines
}
