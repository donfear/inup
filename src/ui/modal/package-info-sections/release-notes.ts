import chalk from 'chalk'
import { PackageSelectionState } from '../../../shared/types'
import { ModalSection } from '../types'
import { getThemeColor } from '../../themes-colors'
import {
  sanitizeMarkdownText,
  linkifyMarkdownText,
  pushWrappedLines,
  isLowSignalTrailerLine,
} from './text'

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

  if (state.releaseNotesLoadingVersion === currentVersion) {
    sections.push({
      key: 'release-loading',
      rows: [chalk.gray(`Loading release notes for v${currentVersion}...`)],
      behavior: 'status',
    })
    return sections
  }

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
