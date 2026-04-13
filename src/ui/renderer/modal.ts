import chalk from 'chalk'
import { PackageSelectionState } from '../../types'
import { getThemeColor } from '../themes-colors'
import { VersionUtils } from '../utils'

// Use shared ANSI stripping utility
const stripAnsi = VersionUtils.stripAnsi

/**
 * Format a number for display (e.g., 1000000 -> "1M", 1000 -> "1K")
 */
function formatNumber(num: number | undefined): string {
  if (!num) return 'N/A'
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

/**
 * Wrap text to fit within max width
 */
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
  if (current) lines.push(current)
  return lines
}

/**
 * Render a loading state for the info modal
 */
export function renderPackageInfoLoading(
  state: PackageSelectionState,
  terminalWidth: number = 80,
  terminalHeight: number = 24
): string[] {
  const modalWidth = Math.min(terminalWidth - 6, 120)
  const padding = Math.floor((terminalWidth - modalWidth) / 2)
  const lines: string[] = []

  // Top padding to center vertically
  const topPadding = Math.max(1, Math.floor((terminalHeight - 10) / 2))
  for (let i = 0; i < topPadding; i++) {
    lines.push('')
  }

  // Modal border
  lines.push(' '.repeat(padding) + chalk.gray('╭' + '─'.repeat(modalWidth - 2) + '╮'))

  // Loading message
  const loadingMsg = '⏳ Loading package info...'
  const msgPadding = modalWidth - 4 - stripAnsi(loadingMsg).length
  lines.push(
    ' '.repeat(padding) +
      chalk.gray('│') +
      ' ' +
      chalk.cyan(loadingMsg) +
      ' '.repeat(Math.max(0, msgPadding)) +
      chalk.gray('│')
  )

  // Package name
  const nameMsg = `${state.name}`
  const namePadding = modalWidth - 4 - nameMsg.length
  lines.push(
    ' '.repeat(padding) +
      chalk.gray('│') +
      ' ' +
      chalk.white(nameMsg) +
      ' '.repeat(Math.max(0, namePadding)) +
      chalk.gray('│')
  )

  lines.push(' '.repeat(padding) + chalk.gray('╰' + '─'.repeat(modalWidth - 2) + '╯'))

  return lines
}

/**
 * Render a full-screen modal overlay showing package information
 * Similar to Turbo's help menu - centered with disabled background
 */
export function renderPackageInfoModal(
  state: PackageSelectionState,
  terminalWidth: number = 80,
  terminalHeight: number = 24
): string[] {
  const modalWidth = Math.min(terminalWidth - 6, 120) // Leave margins
  const padding = Math.floor((terminalWidth - modalWidth) / 2)
  const lines: string[] = []

  // Top padding to center vertically
  const topPadding = Math.max(1, Math.floor((terminalHeight - 20) / 2))
  for (let i = 0; i < topPadding; i++) {
    lines.push('')
  }

  // Modal border and header
  lines.push(' '.repeat(padding) + chalk.gray('╭' + '─'.repeat(modalWidth - 2) + '╮'))

  // Title with package name
  const title = ` ℹ️  ${state.name}`
  const titleLength = stripAnsi(title).length
  const titlePadding = Math.max(0, modalWidth - 2 - titleLength)
  lines.push(
    ' '.repeat(padding) +
      chalk.gray('│') +
      chalk.cyan.bold(title) +
      ' '.repeat(titlePadding) +
      chalk.gray('│')
  )

  // License and author line
  const authorLicense = `${state.author || 'Unknown'} • ${state.license || 'MIT'}`
  const authorLength = authorLicense.length
  const authorPadding = Math.max(0, modalWidth - 3 - authorLength)
  lines.push(
    ' '.repeat(padding) +
      chalk.gray('│') +
      ' ' +
      chalk.gray(authorLicense) +
      ' '.repeat(authorPadding) +
      chalk.gray('│')
  )

  lines.push(' '.repeat(padding) + chalk.gray('├' + '─'.repeat(modalWidth - 2) + '┤'))

  // Current and target versions
  const currentVersion = chalk.yellow(state.currentVersionSpecifier)
  const targetVersion = chalk.green(
    state.selectedOption === 'range' ? state.rangeVersion : state.latestVersion
  )
  const versionText = `Current: ${currentVersion} → Target: ${targetVersion}`
  const versionLength = stripAnsi(versionText).length
  const versionPadding = Math.max(0, modalWidth - 3 - versionLength)
  lines.push(
    ' '.repeat(padding) +
      chalk.gray('│') +
      ' ' +
      versionText +
      ' '.repeat(versionPadding) +
      chalk.gray('│')
  )

  // Weekly downloads
  if (state.weeklyDownloads !== undefined) {
    const downloadsText = `📊 ${formatNumber(state.weeklyDownloads)} downloads/week`
    const downloadsLength = stripAnsi(downloadsText).length
    const downloadsPadding = Math.max(0, modalWidth - 3 - downloadsLength)
    lines.push(
      ' '.repeat(padding) +
        chalk.gray('│') +
        ' ' +
        getThemeColor('primary')(downloadsText) +
        ' '.repeat(downloadsPadding) +
        chalk.gray('│')
    )
  }

  // Description
  if (state.description) {
    lines.push(' '.repeat(padding) + chalk.gray('├' + '─'.repeat(modalWidth - 2) + '┤'))
    const descriptionLines = wrapText(state.description, modalWidth - 4)
    for (const descLine of descriptionLines) {
      const descLength = descLine.length
      const descPadding = Math.max(0, modalWidth - 3 - descLength)
      lines.push(
        ' '.repeat(padding) +
          chalk.gray('│') +
          ' ' +
          chalk.white(descLine) +
          ' '.repeat(descPadding) +
          chalk.gray('│')
      )
    }
  }

  // Security vulnerabilities section
  if (state.vulnerability && state.vulnerability.count > 0) {
    lines.push(' '.repeat(padding) + chalk.gray('├' + '─'.repeat(modalWidth - 2) + '┤'))

    const severityColors: Record<string, (text: string) => string> = {
      critical: chalk.bgRed.white.bold,
      high: chalk.red.bold,
      moderate: chalk.yellow,
      low: chalk.gray,
      info: chalk.gray,
    }

    const sevColor = severityColors[state.vulnerability.highestSeverity] || chalk.white
    const vulnHeader = `⚠ ${state.vulnerability.count} known vulnerabilit${state.vulnerability.count > 1 ? 'ies' : 'y'} (${sevColor(state.vulnerability.highestSeverity.toUpperCase())})`
    const vulnHeaderLength = stripAnsi(vulnHeader).length
    const vulnHeaderPadding = Math.max(0, modalWidth - 3 - vulnHeaderLength)
    lines.push(
      ' '.repeat(padding) +
        chalk.gray('│') +
        ' ' +
        chalk.red.bold(vulnHeader) +
        ' '.repeat(vulnHeaderPadding) +
        chalk.gray('│')
    )

    // Show up to 5 advisories with title, severity and link
    const advisoriesToShow = state.vulnerability.advisories.slice(0, 5)
    for (const advisory of advisoriesToShow) {
      const advColor = severityColors[advisory.severity] || chalk.white
      const sevLabel = advColor(advisory.severity.toUpperCase().padEnd(8))
      const titleMaxWidth = modalWidth - 16
      const truncatedTitle =
        advisory.title.length > titleMaxWidth
          ? advisory.title.substring(0, titleMaxWidth - 3) + '...'
          : advisory.title
      const advisoryLine = `  ${sevLabel} ${truncatedTitle}`
      const advisoryLength = stripAnsi(advisoryLine).length
      const advisoryPadding = Math.max(0, modalWidth - 3 - advisoryLength)
      lines.push(
        ' '.repeat(padding) +
          chalk.gray('│') +
          ' ' +
          advisoryLine +
          ' '.repeat(advisoryPadding) +
          chalk.gray('│')
      )

      // Show advisory URL
      const urlLine = `           ${advisory.url}`
      const urlMaxWidth = modalWidth - 4
      const truncatedUrl = urlLine.length > urlMaxWidth ? urlLine.substring(0, urlMaxWidth - 3) + '...' : urlLine
      const urlLength = stripAnsi(truncatedUrl).length
      const urlPadding = Math.max(0, modalWidth - 3 - urlLength)
      lines.push(
        ' '.repeat(padding) +
          chalk.gray('│') +
          ' ' +
          chalk.underline(getThemeColor('primary')(truncatedUrl)) +
          ' '.repeat(urlPadding) +
          chalk.gray('│')
      )
    }

    if (state.vulnerability.advisories.length > 5) {
      const moreText = `  ... and ${state.vulnerability.advisories.length - 5} more`
      const morePadding = Math.max(0, modalWidth - 3 - moreText.length)
      lines.push(
        ' '.repeat(padding) +
          chalk.gray('│') +
          ' ' +
          chalk.gray(moreText) +
          ' '.repeat(morePadding) +
          chalk.gray('│')
      )
    }
  }

  // Changelog/Releases section (moved to middle)
  if (state.repository) {
    lines.push(' '.repeat(padding) + chalk.gray('├' + '─'.repeat(modalWidth - 2) + '┤'))
    const repoLabel = 'Changelog:'
    const repoUrl = state.repository.substring(0, modalWidth - 20)
    const repoText = ` ${repoLabel} ${chalk.underline(getThemeColor('primary')(repoUrl))}`
    const repoLength = stripAnsi(repoText).length
    const repoPadding = Math.max(0, modalWidth - 3 - repoLength)
    lines.push(
      ' '.repeat(padding) +
        chalk.gray('│') +
        repoText +
        ' '.repeat(repoPadding) +
        chalk.gray('│')
    )
  }

  // Links section
  if (state.homepage) {
    lines.push(' '.repeat(padding) + chalk.gray('├' + '─'.repeat(modalWidth - 2) + '┤'))

    const homeLabel = 'Homepage:'
    const homeUrl = state.homepage.substring(0, modalWidth - 20)
    const homeText = ` ${homeLabel} ${chalk.underline(getThemeColor('primary')(homeUrl))}`
    const homeLength = stripAnsi(homeText).length
    const homePadding = Math.max(0, modalWidth - 3 - homeLength)
    lines.push(
      ' '.repeat(padding) +
        chalk.gray('│') +
        homeText +
        ' '.repeat(homePadding) +
        chalk.gray('│')
    )
  }

  // Footer
  lines.push(' '.repeat(padding) + chalk.gray('╰' + '─'.repeat(modalWidth - 2) + '╯'))

  return lines
}
