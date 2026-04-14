import chalk from 'chalk'
import { PackageSelectionState } from '../../types'
import { ModalSection } from './types'
import { getThemeColor } from '../themes-colors'
import {
  getVulnerabilityLinkLabel,
  getVulnerabilitySeverityColor,
  selectRepresentativeAdvisory,
} from '../presenters/vulnerability'
import { getVisualLength, truncatePlainText, wrapPlainText } from '../utils'

/**
 * Format markdown release notes for terminal display.
 * Applies syntax highlighting for headers, breaking changes, and bullet points.
 */
function formatReleaseNotesMarkdown(markdown: string, width: number): string[] {
  const lines: string[] = []
  const rawLines = markdown.split('\n')
  let prevBlank = false

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trimEnd()

    // Collapse multiple blank lines
    if (trimmed === '') {
      if (!prevBlank && lines.length > 0) {
        lines.push('')
        prevBlank = true
      }
      continue
    }
    prevBlank = false

    // Strip HTML tags
    const cleaned = trimmed.replace(/<[^>]+>/g, '')

    // Headers: ### Breaking Changes, ### Features, ### Bug Fixes, etc.
    const headerMatch = cleaned.match(/^(#{1,4})\s+(.+)/)
    if (headerMatch) {
      const title = headerMatch[2]
      const lower = title.toLowerCase()
      if (lower.includes('breaking')) {
        lines.push(chalk.red.bold(`  ${title}`))
      } else if (lower.includes('feature') || lower.includes('added')) {
        lines.push(chalk.green.bold(`  ${title}`))
      } else if (lower.includes('fix') || lower.includes('bug')) {
        lines.push(chalk.yellow.bold(`  ${title}`))
      } else if (lower.includes('deprecat')) {
        lines.push(chalk.magenta.bold(`  ${title}`))
      } else {
        lines.push(chalk.white.bold(`  ${title}`))
      }
      continue
    }

    // Bullet points: - item, * item
    const bulletMatch = cleaned.match(/^(\s*)[*-]\s+(.+)/)
    if (bulletMatch) {
      const indent = Math.min(bulletMatch[1].length, 4)
      const text = bulletMatch[2]
      // Check for BREAKING in bullet text
      const styledText = /breaking/i.test(text) ? chalk.red(text) : text
      const prefix = ' '.repeat(indent + 2) + chalk.gray('•') + ' '
      const wrapped = wrapPlainText(text, width - indent - 4)
      if (wrapped.length > 0) {
        lines.push(prefix + (/breaking/i.test(text) ? chalk.red(wrapped[0]) : wrapped[0]))
        for (let i = 1; i < wrapped.length; i++) {
          lines.push(' '.repeat(indent + 4) + (/breaking/i.test(text) ? chalk.red(wrapped[i]) : wrapped[i]))
        }
      }
      continue
    }

    // Regular text — wrap to width
    const wrapped = wrapPlainText(cleaned, width - 2)
    for (const line of wrapped) {
      lines.push('  ' + line)
    }
  }

  // Trim trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return lines
}

/**
 * Build release notes sections from loaded version data.
 * Returns one section per loaded version, plus loading/hint indicators.
 */
export function buildReleaseNotesSections(
  state: PackageSelectionState,
  modalWidth: number
): ModalSection[] {
  const sections: ModalSection[] = []

  if (!state.releaseNotesVersions || state.releaseNotesVersions.length === 0) {
    return sections
  }

  const loaded = state.releaseNotesLoaded
  if (!loaded || loaded.size === 0) {
    // Still loading the first version
    if (state.releaseNotesLoadingVersion) {
      sections.push({
        key: 'release-loading',
        rows: [chalk.gray(`  ⏳ Loading release notes for v${state.releaseNotesLoadingVersion}...`)],
      })
    }
    return sections
  }

  // Render each loaded version's notes
  for (const version of state.releaseNotesVersions) {
    if (!loaded.has(version)) break // Stop at first unloaded version

    const content = loaded.get(version)

    // Skip versions with no release notes — don't clutter with empty entries
    if (!content) continue

    const versionHeader = getThemeColor('primary')(`  v${version}`)
    const rows: string[] = [chalk.bold(versionHeader)]
    const formatted = formatReleaseNotesMarkdown(content, modalWidth - 4)
    rows.push(...formatted)

    sections.push({
      key: `release-${version}`,
      rows,
    })
  }

  // Show loading indicator for in-flight version
  if (state.releaseNotesLoadingVersion && !loaded.has(state.releaseNotesLoadingVersion)) {
    sections.push({
      key: 'release-loading',
      rows: [chalk.gray(`  ⏳ Loading v${state.releaseNotesLoadingVersion}...`)],
    })
  }

  // Show hint if more versions are available
  const allLoaded = state.releaseNotesVersions.every((v) => loaded.has(v))
  if (!allLoaded && !state.releaseNotesLoadingVersion) {
    sections.push({
      key: 'release-more',
      rows: [chalk.gray('  ↓ Scroll for older versions')],
    })
  }

  // If all versions were checked but none had notes, show a single message
  if (allLoaded && sections.length === 0) {
    sections.push({
      key: 'release-none',
      rows: [chalk.gray.italic('  No release notes found for any version in this range')],
    })
  }

  return sections
}

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

  // Release notes sections (after description, before vulnerability)
  const releaseNotesSections = buildReleaseNotesSections(state, modalWidth)
  sections.push(...releaseNotesSections)

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
