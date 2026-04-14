import chalk from 'chalk'
import { PackageSelectionState } from '../../types'
import {
  getModalWidth,
  fitModalSections,
  getModalFrameHeight,
  getModalSectionRowCount,
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
  usesInternalScroll: boolean
}

export function renderPackageInfoLoading(
  state: PackageSelectionState,
  terminalWidth: number = 80,
  terminalHeight: number = 24
): ModalRenderResult {
  const sections: ModalSection[] = [
    {
      key: 'loading',
      rows: [chalk.cyan('Loading package info'), chalk.white(state.name)],
      required: true,
      behavior: 'status',
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
    usesInternalScroll: false,
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
  const maxHeight = Math.max(10, terminalHeight - 2)
  const trimOrder = ['homepage', 'changelog', 'description']
  const compactSections = fitModalSections(allSections, maxHeight, trimOrder)
  const hasScrollableBody = allSections.some((section) => section.behavior === 'body')

  if (!hasScrollableBody || getModalFrameHeight(compactSections) <= maxHeight) {
    return {
      lines: renderModalFrame(compactSections, {
        terminalWidth,
        terminalHeight,
        minWidth: 60,
        maxWidth: 120,
      }),
      maxScrollOffset: 0,
      totalContentRows: 0,
      usesInternalScroll: false,
    }
  }

  const fixedModalHeight = maxHeight
  const padding = Math.floor((terminalWidth - modalWidth) / 2)

  const pinnedSections = allSections.filter((section) => (section.behavior ?? 'pinned') === 'pinned')
  const bodySections = allSections.filter((section) => (section.behavior ?? 'pinned') !== 'pinned')
  const minBodyRows = 3
  const reservedBodyRows = minBodyRows + (bodySections.length > 0 ? 1 : 0)
  const maxPinnedHeight = Math.max(6, fixedModalHeight - reservedBodyRows)
  const fittedPinned = fitModalSections(pinnedSections, maxPinnedHeight, trimOrder)
  const pinnedRowCount = getModalSectionRowCount(fittedPinned)
  const availableForBody = Math.max(
    minBodyRows,
    fixedModalHeight - 2 - pinnedRowCount - (bodySections.length > 0 ? 1 : 0)
  )

  const bodyRows: Array<{ row: string; sectionIndex: number }> = []
  bodySections.forEach((section, index) => {
    if (index > 0) {
      bodyRows.push({ row: '__SEPARATOR__', sectionIndex: index })
    }
    for (const row of section.rows) {
      bodyRows.push({ row, sectionIndex: index })
    }
  })

  const totalScrollableRows = bodyRows.length
  const maxScroll = Math.max(0, totalScrollableRows - availableForBody)
  const clampedOffset = Math.min(scrollOffset, maxScroll)
  const hasMoreVersions =
    !!state.releaseNotesVersions &&
    (state.releaseNotesNextIndex ?? 0) < state.releaseNotesVersions.length
  const footerStatus = state.releaseNotesLoadingVersion
    ? chalk.gray(`Loading release notes for v${state.releaseNotesLoadingVersion}`)
    : hasMoreVersions && clampedOffset >= maxScroll
      ? chalk.gray('Press Down to load older versions')
      : maxScroll > 0
        ? clampedOffset < maxScroll
          ? chalk.gray(
              `Lines ${clampedOffset + 1}-${Math.min(clampedOffset + availableForBody, totalScrollableRows)} of ${totalScrollableRows}`
            )
          : chalk.gray('End of release notes')
        : null
  const visibleBodyRows = footerStatus ? Math.max(1, availableForBody - 1) : availableForBody
  const visibleSlice = bodyRows.slice(clampedOffset, clampedOffset + visibleBodyRows)
  const lines: string[] = []
  const topPadding = Math.max(0, Math.floor((terminalHeight - fixedModalHeight) / 2))
  for (let i = 0; i < topPadding; i++) {
    lines.push('')
  }

  lines.push(' '.repeat(padding) + chalk.gray('╭' + '─'.repeat(modalWidth - 2) + '╮'))

  fittedPinned.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      lines.push(renderModalSeparator(padding, modalWidth))
    }
    for (const row of section.rows) {
      lines.push(renderModalRow(padding, modalWidth, row))
    }
  })

  if (bodySections.length > 0) {
    lines.push(renderModalSeparator(padding, modalWidth))
  }

  let renderedScrollRows = 0
  for (const entry of visibleSlice) {
    if (entry.row === '__SEPARATOR__') {
      lines.push(renderModalSeparator(padding, modalWidth))
    } else {
      lines.push(renderModalRow(padding, modalWidth, entry.row))
    }
    renderedScrollRows++
  }

  const usedContentRows =
    pinnedRowCount +
    (bodySections.length > 0 ? 1 : 0) +
    renderedScrollRows +
    (footerStatus ? 1 : 0)
  const totalContentSlots = fixedModalHeight - 2
  const emptyRows = Math.max(0, totalContentSlots - usedContentRows)
  for (let i = 0; i < emptyRows; i++) {
    lines.push(renderModalRow(padding, modalWidth, ''))
  }

  if (footerStatus) {
    lines.push(renderModalRow(padding, modalWidth, footerStatus))
  }

  lines.push(' '.repeat(padding) + chalk.gray('╰' + '─'.repeat(modalWidth - 2) + '╯'))

  return {
    lines,
    maxScrollOffset: maxScroll,
    totalContentRows: totalScrollableRows,
    usesInternalScroll: true,
  }
}
