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

function formatTerminalLink(label: string, url: string): string {
  return `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007`
}

function sanitizeMarkdownText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function linkifyContributorMentions(text: string): string {
  return text.replace(/(^|[\s(])@([a-zA-Z0-9-]+)/g, (match, prefix: string, username: string) => {
    return `${prefix}${formatTerminalLink(`@${username}`, `https://github.com/${username}`)}`
  })
}

function pushWrappedLines(
  lines: string[],
  text: string,
  width: number,
  firstPrefix: string,
  restPrefix: string = firstPrefix,
  style?: (value: string) => string
): void {
  const firstWidth = Math.max(1, width - getVisualLength(firstPrefix))
  const restWidth = Math.max(1, width - getVisualLength(restPrefix))
  const segments = wrapPlainText(text, firstWidth)

  if (segments.length === 0) {
    lines.push(firstPrefix.trimEnd())
    return
  }

  lines.push(firstPrefix + (style ? style(segments[0]) : segments[0]))
  for (let i = 1; i < segments.length; i++) {
    const wrappedSegments = wrapPlainText(segments[i], restWidth)
    for (const segment of wrappedSegments) {
      lines.push(restPrefix + (style ? style(segment) : segment))
    }
  }
}

function isLowSignalTrailerLine(text: string): boolean {
  const normalized = text.toLowerCase()
  return (
    normalized.startsWith('compare') ||
    normalized.startsWith('full changelog') ||
    normalized.startsWith('see full changelog') ||
    normalized.startsWith('release notes') ||
    normalized.includes('/compare/') ||
    /^\w+: https?:\/\//.test(normalized)
  )
}

function formatReleaseNotesMarkdown(markdown: string, width: number): string[] {
  const lines: string[] = []
  const rawLines = markdown.split('\n')
  let prevBlank = false

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()

    if (trimmed === '') {
      if (!prevBlank && lines.length > 0) {
        lines.push('')
        prevBlank = true
      }
      continue
    }
    prevBlank = false

    if (/^```/.test(trimmed) || /^---+$/.test(trimmed)) {
      continue
    }

    const cleaned = sanitizeMarkdownText(trimmed)
    if (!cleaned) {
      continue
    }

    const quoteMatch = trimmed.match(/^>\s*(.+)/)
    if (quoteMatch) {
      const quoteBody = linkifyContributorMentions(sanitizeMarkdownText(quoteMatch[1]))
      const admonitionMatch = quoteBody.match(/^\[!([A-Z]+)\]$/i)
      if (admonitionMatch) {
        const label = `${admonitionMatch[1][0]}${admonitionMatch[1].slice(1).toLowerCase()}`
        if (lines.length > 0 && lines[lines.length - 1] !== '') {
          lines.push('')
        }
        lines.push(chalk.blue.bold(`  ${label}`))
      } else {
        pushWrappedLines(lines, quoteBody, width, '  ', '  ', chalk.gray)
      }
      continue
    }

    const headerMatch = cleaned.match(/^(#{1,6})\s+(.+)/)
    if (headerMatch) {
      const title = sanitizeMarkdownText(headerMatch[2])
      const lower = title.toLowerCase()
      let style = chalk.white.bold

      if (lower.includes('breaking')) {
        style = chalk.red.bold
      } else if (lower.includes('feature') || lower.includes('added') || lower.includes('improvement')) {
        style = chalk.green.bold
      } else if (lower.includes('fix') || lower.includes('bug')) {
        style = chalk.yellow.bold
      } else if (lower.includes('deprecat')) {
        style = chalk.magenta.bold
      }

      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        lines.push('')
      }
      lines.push(style(`  ${title}`))
      continue
    }

    const bulletMatch = cleaned.match(/^(\s*)[*-]\s+(.+)/)
    if (bulletMatch) {
      const indentLevel = Math.min(2, Math.floor(bulletMatch[1].length / 2))
      const prefix = `  ${'  '.repeat(indentLevel)}${chalk.gray('•')} `
      const restPrefix = `  ${'  '.repeat(indentLevel + 1)}`
      const style = /breaking/i.test(bulletMatch[2]) ? chalk.red : undefined
      pushWrappedLines(
        lines,
        linkifyContributorMentions(sanitizeMarkdownText(bulletMatch[2])),
        width,
        prefix,
        restPrefix,
        style
      )
      continue
    }

    const orderedMatch = cleaned.match(/^(\s*)(\d+)\.\s+(.+)/)
    if (orderedMatch) {
      const indentLevel = Math.min(2, Math.floor(orderedMatch[1].length / 2))
      const marker = `${orderedMatch[2]}.`
      const prefix = `  ${'  '.repeat(indentLevel)}${marker} `
      const restPrefix = `  ${'  '.repeat(indentLevel)}${' '.repeat(marker.length + 1)}`
      pushWrappedLines(
        lines,
        linkifyContributorMentions(sanitizeMarkdownText(orderedMatch[3])),
        width,
        prefix,
        restPrefix
      )
      continue
    }

    const style = isLowSignalTrailerLine(cleaned) ? chalk.gray : undefined
    pushWrappedLines(lines, linkifyContributorMentions(cleaned), width, '  ', '  ', style)
  }

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
    if (state.releaseNotesLoadingVersion) {
      sections.push({
        key: 'release-loading',
        rows: [chalk.gray(`Loading release notes for v${state.releaseNotesLoadingVersion}`)],
        behavior: 'status',
      })
    }
    return sections
  }

  for (const version of state.releaseNotesVersions) {
    if (!loaded.has(version)) break // Stop at first unloaded version

    const content = loaded.get(version)

    if (!content) continue

    const versionHeader = getThemeColor('primary')(`Version ${version}`)
    const rows: string[] = [chalk.bold(versionHeader)]
    const formatted = formatReleaseNotesMarkdown(content, modalWidth - 4)
    rows.push(...formatted)

    sections.push({
      key: `release-${version}`,
      rows,
      behavior: 'body',
    })
  }

  const hasRenderedReleaseNotes = sections.some((section) => section.behavior === 'body')

  if (state.releaseNotesLoadingVersion && !loaded.has(state.releaseNotesLoadingVersion)) {
    sections.push({
      key: 'release-loading',
      rows: [chalk.gray(`Loading release notes for v${state.releaseNotesLoadingVersion}`)],
      behavior: 'status',
    })
  }

  const allLoaded = (state.releaseNotesNextIndex ?? 0) >= state.releaseNotesVersions.length
  if (!allLoaded && !state.releaseNotesLoadingVersion && hasRenderedReleaseNotes) {
    sections.push({
      key: 'release-more',
      rows: [chalk.gray('Press Down to load older versions')],
      behavior: 'status',
    })
  }

  if (sections.length === 0) {
    sections.push({
      key: 'release-none',
      rows: [chalk.gray.italic('No release notes found for this version range')],
      behavior: 'status',
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
  const title = chalk.cyan.bold(`Package: ${state.name}`)
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
    {
      key: 'meta',
      rows: [
        `Current: ${currentVersion}  Target: ${targetVersion}`,
        ...(state.weeklyDownloads !== undefined
          ? [getThemeColor('primary')(`Downloads/week: ${formatNumber(state.weeklyDownloads)}`)]
          : []),
      ],
      required: true,
      behavior: 'pinned',
    },
  ]

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

  const releaseNotesSections = buildReleaseNotesSections(state, modalWidth)
  sections.push(...releaseNotesSections)

  return sections
}
