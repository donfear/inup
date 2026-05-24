import path from 'node:path'
import chalk from 'chalk'
import { PackageSelectionState } from '../../types'
import { InfoModalTab, ModalSection } from './types'
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

function getRepositoryBaseUrl(repositoryUrl: string | undefined): string | null {
  if (!repositoryUrl) {
    return null
  }

  return repositoryUrl.replace(/\/releases\/?$/, '')
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
  return text.replace(/(^|[\s(])@([a-zA-Z0-9-]+)/g, (_match, prefix: string, username: string) => {
    return `${prefix}${formatTerminalLink(`@${username}`, `https://github.com/${username}`)}`
  })
}

function linkifyRepositoryReferences(text: string, repositoryUrl?: string): string {
  const repoBaseUrl = getRepositoryBaseUrl(repositoryUrl)
  if (!repoBaseUrl || !repoBaseUrl.includes('github.com')) {
    return text
  }

  return text
    .replace(/(^|[\s(])#(\d+)\b/g, (_match, prefix: string, number: string) => {
      return `${prefix}${formatTerminalLink(`#${number}`, `${repoBaseUrl}/pull/${number}`)}`
    })
    .replace(/(^|[\s(])([0-9a-f]{7,40})\b/gi, (_match, prefix: string, hash: string) => {
      return `${prefix}${formatTerminalLink(hash, `${repoBaseUrl}/commit/${hash}`)}`
    })
}

function linkifyMarkdownText(text: string, repositoryUrl?: string): string {
  return linkifyRepositoryReferences(linkifyContributorMentions(text), repositoryUrl)
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

function formatReleaseNotesMarkdown(
  markdown: string,
  width: number,
  repositoryUrl?: string
): string[] {
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
      const quoteBody = linkifyMarkdownText(sanitizeMarkdownText(quoteMatch[1]), repositoryUrl)
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
      } else if (
        lower.includes('feature') ||
        lower.includes('added') ||
        lower.includes('improvement')
      ) {
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
        linkifyMarkdownText(sanitizeMarkdownText(bulletMatch[2]), repositoryUrl),
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
        linkifyMarkdownText(sanitizeMarkdownText(orderedMatch[3]), repositoryUrl),
        width,
        prefix,
        restPrefix
      )
      continue
    }

    const style = isLowSignalTrailerLine(cleaned) ? chalk.gray : undefined
    pushWrappedLines(lines, linkifyMarkdownText(cleaned, repositoryUrl), width, '  ', '  ', style)
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return lines
}

/**
 * Build release notes sections for the currently viewed version.
 * Shows one version at a time with navigation indicators.
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
  const viewIndex = state.releaseNotesViewIndex ?? 0
  const totalVersions = state.releaseNotesVersions.length
  const currentVersion = state.releaseNotesVersions[viewIndex]

  if (!currentVersion) return sections

  // Show loading state for the viewed version
  if (state.releaseNotesLoadingVersion === currentVersion) {
    sections.push({
      key: 'release-loading',
      rows: [chalk.gray(`Loading release notes for v${currentVersion}...`)],
      behavior: 'status',
    })
    return sections
  }

  // Version not yet loaded (and not currently loading)
  if (!loaded || !loaded.has(currentVersion)) {
    sections.push({
      key: 'release-pending',
      rows: [chalk.gray(`Press ←/→ to load release notes for v${currentVersion}`)],
      behavior: 'status',
    })
    return sections
  }

  const content = loaded.get(currentVersion)

  if (!content) {
    // Version was loaded but had no release notes
    sections.push({
      key: 'release-none',
      rows: [chalk.gray.italic(`No release notes found for v${currentVersion}`)],
      behavior: 'status',
    })
  } else {
    const versionHeader = getThemeColor('primary')(`Version ${currentVersion}`)
    const navHint = totalVersions > 1 ? chalk.gray(` (${viewIndex + 1}/${totalVersions})`) : ''
    const rows: string[] = [chalk.bold(versionHeader) + navHint]
    const formatted = formatReleaseNotesMarkdown(content, modalWidth - 4, state.repository)
    rows.push(...formatted)

    sections.push({
      key: `release-${currentVersion}`,
      rows,
      behavior: 'body',
    })
  }

  // Navigation hints
  const canGoNewer = viewIndex > 0
  const canGoOlder = viewIndex < totalVersions - 1
  if (canGoNewer || canGoOlder) {
    const hints: string[] = []
    if (canGoNewer) hints.push('← newer')
    if (canGoOlder) hints.push('→ older')
    sections.push({
      key: 'release-nav',
      rows: [chalk.gray(hints.join('  ·  '))],
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

function getUsedByPaths(state: PackageSelectionState): string[] {
  return state.packageJsonPaths ?? [state.packageJsonPath]
}

function buildTabBarSuffix(activeTab: InfoModalTab, usedByCount: number): string {
  const styleFor = (tab: InfoModalTab) =>
    tab === activeTab ? chalk.bold.underline : chalk.gray
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
