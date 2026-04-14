import chalk from 'chalk'
import { PackageSelectionState } from '../../types'
import {
  getModalWidth,
  fitModalSections,
  renderModalFrame,
  renderModalRow,
  renderModalSeparator,
} from './layout'
import { buildPackageInfoSections } from './package-info-sections'
import { ModalSection } from './types'

export interface ModalRenderResult {
  lines: string[]
  maxScrollOffset: number
  totalContentRows: number
}

export function renderPackageInfoLoading(
  state: PackageSelectionState,
  terminalWidth: number = 80,
  terminalHeight: number = 24
): ModalRenderResult {
  const sections: ModalSection[] = [
    {
      key: 'loading',
      rows: [chalk.cyan('⏳ Loading package info...'), chalk.white(state.name)],
      required: true,
    },
  ]

  return {
    lines: renderModalFrame(sections, {
      terminalWidth,
      terminalHeight,
      minWidth: 50,
      maxWidth: 120,
    }),
    maxScrollOffset: 0,
    totalContentRows: 2,
  }
}

export function renderPackageInfoModal(
  state: PackageSelectionState,
  terminalWidth: number = 80,
  terminalHeight: number = 24,
  scrollOffset: number = 0
): ModalRenderResult {
  const modalWidth = getModalWidth(terminalWidth, 60, 120)
  const allSections = buildPackageInfoSections(state, modalWidth)

  // Check if we have release notes content (scrollable content)
  const hasReleaseNotes = allSections.some((s) => s.key.startsWith('release-'))

  if (!hasReleaseNotes) {
    // No release notes — use the classic fitModalSections approach
    const maxHeight = Math.max(10, terminalHeight - 2)
    const fittedSections = fitModalSections(allSections, maxHeight, [
      'homepage',
      'changelog',
      'description',
    ])

    return {
      lines: renderModalFrame(fittedSections, {
        terminalWidth,
        terminalHeight,
        minWidth: 60,
        maxWidth: 120,
      }),
      maxScrollOffset: 0,
      totalContentRows: 0,
    }
  }

  // Has release notes — render fixed-height modal with internal scrolling
  // The modal height is fixed to fill the available terminal space
  const fixedModalHeight = Math.max(12, terminalHeight - 6) // Leave room for header lines above modal
  const padding = Math.floor((terminalWidth - modalWidth) / 2)

  // Separate pinned from scrollable sections
  const pinnedSections: ModalSection[] = []
  const scrollableSections: ModalSection[] = []

  for (const section of allSections) {
    if (section.key.startsWith('release-')) {
      scrollableSections.push(section)
    } else {
      pinnedSections.push(section)
    }
  }

  // Fit pinned sections (trim homepage/changelog/description if needed)
  const fittedPinned = fitModalSections(pinnedSections, fixedModalHeight - 5, [
    'homepage',
    'changelog',
    'description',
  ])

  // Calculate how many rows the pinned sections take (including separators)
  const pinnedRowCount = fittedPinned.reduce(
    (sum, section, index) => sum + section.rows.length + (index > 0 ? 1 : 0),
    0
  )

  // Available rows for scrollable content inside the fixed frame
  // fixedModalHeight = top border + content + bottom border
  // content = pinnedRows + 1 separator + scrollableRows
  const availableForScrollable = Math.max(3, fixedModalHeight - 2 - pinnedRowCount - 1)

  // Flatten scrollable rows (with separators between sections)
  const scrollableRows: { row: string; sectionIndex: number }[] = []
  scrollableSections.forEach((section, index) => {
    if (index > 0) {
      scrollableRows.push({ row: '__SEPARATOR__', sectionIndex: index })
    }
    for (const row of section.rows) {
      scrollableRows.push({ row, sectionIndex: index })
    }
  })

  const totalScrollableRows = scrollableRows.length
  const maxScroll = Math.max(0, totalScrollableRows - availableForScrollable)
  const clampedOffset = Math.min(scrollOffset, maxScroll)

  // Get the visible slice of scrollable rows
  const visibleSlice = scrollableRows.slice(
    clampedOffset,
    clampedOffset + availableForScrollable
  )

  // Build the fixed-height modal manually
  const lines: string[] = []

  // Vertical centering
  const topPadding = Math.max(0, Math.floor((terminalHeight - fixedModalHeight) / 2))
  for (let i = 0; i < topPadding; i++) {
    lines.push('')
  }

  // Top border
  lines.push(' '.repeat(padding) + chalk.gray('╭' + '─'.repeat(modalWidth - 2) + '╮'))

  // Render pinned sections
  fittedPinned.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      lines.push(renderModalSeparator(padding, modalWidth))
    }
    for (const row of section.rows) {
      lines.push(renderModalRow(padding, modalWidth, row))
    }
  })

  // Separator between pinned and scrollable
  if (scrollableSections.length > 0) {
    lines.push(renderModalSeparator(padding, modalWidth))
  }

  // Render visible scrollable rows
  let renderedScrollRows = 0
  for (const entry of visibleSlice) {
    if (entry.row === '__SEPARATOR__') {
      lines.push(renderModalSeparator(padding, modalWidth))
    } else {
      lines.push(renderModalRow(padding, modalWidth, entry.row))
    }
    renderedScrollRows++
  }

  // Pad remaining rows to maintain fixed height
  const usedContentRows = pinnedRowCount + (scrollableSections.length > 0 ? 1 : 0) + renderedScrollRows
  const totalContentSlots = fixedModalHeight - 2 // Minus top/bottom border
  const emptyRows = Math.max(0, totalContentSlots - usedContentRows)
  for (let i = 0; i < emptyRows; i++) {
    lines.push(renderModalRow(padding, modalWidth, ''))
  }

  // Scroll indicator row (replaces last empty row if scrollable)
  if (maxScroll > 0) {
    // Remove last empty row to make room for indicator
    if (emptyRows > 0) {
      lines.pop()
    }
    const indicator =
      clampedOffset < maxScroll
        ? chalk.gray(
            `↕ ${clampedOffset + 1}-${Math.min(clampedOffset + availableForScrollable, totalScrollableRows)} of ${totalScrollableRows} lines`
          )
        : chalk.gray('↑ End of release notes')
    lines.push(renderModalRow(padding, modalWidth, indicator))
  }

  // Bottom border
  lines.push(' '.repeat(padding) + chalk.gray('╰' + '─'.repeat(modalWidth - 2) + '╯'))

  return {
    lines,
    maxScrollOffset: maxScroll,
    totalContentRows: totalScrollableRows,
  }
}
