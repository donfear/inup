import chalk from 'chalk'
import type { PackageSelectionState } from '../../../shared/types'
import {
  fitModalSections,
  getModalFrameHeight,
  getModalSectionRowCount,
  getModalWidth,
  renderModalFrame,
  renderModalRow,
  renderModalSeparator,
} from './layout'
import { buildPackageInfoSections } from './package-info-sections'
import type { InfoModalTab, ModalSection } from './types'

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
  scrollOffset: number = 0,
  activeTab: InfoModalTab = 'info'
): ModalRenderResult {
  const modalWidth = getModalWidth(terminalWidth, 60, 120)
  const allSections = buildPackageInfoSections(state, modalWidth, activeTab)
  const maxHeight = Math.max(10, terminalHeight - 2)
  const trimOrder = ['homepage', 'changelog', 'description']
  const compactSections = fitModalSections(allSections, maxHeight, trimOrder)
  const hasScrollableBody = allSections.some((section) => section.behavior === 'body')

  if (!hasScrollableBody || getModalFrameHeight(compactSections) <= maxHeight) {
    return {
      lines: renderModalFrame(compactSections, {
        terminalWidth,
        terminalHeight: Math.max(8, terminalHeight - 4),
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

  // Every section built by buildPackageInfoSections declares a behavior, so we
  // partition directly: 'pinned' stays fixed, everything else scrolls.
  const pinnedSections = allSections.filter((section) => section.behavior === 'pinned')
  const bodySections = allSections.filter((section) => section.behavior !== 'pinned')
  const minBodyRows = 3
  // hasScrollableBody guaranteed a 'body' section above, so bodySections is
  // non-empty and always reserves its separator row.
  const reservedBodyRows = minBodyRows + 1
  const maxPinnedHeight = Math.max(6, fixedModalHeight - reservedBodyRows)
  const fittedPinned = fitModalSections(pinnedSections, maxPinnedHeight, trimOrder)
  const pinnedRowCount = getModalSectionRowCount(fittedPinned)
  // bodySections is non-empty here (see reservedBodyRows), so its separator
  // row is always subtracted.
  const availableForBody = Math.max(minBodyRows, fixedModalHeight - 2 - pinnedRowCount - 1)

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
  const totalVersions = state.releaseNotesVersions?.length ?? 0
  const viewIndex = state.releaseNotesViewIndex ?? 0
  const canGoNewer = viewIndex > 0
  const canGoOlder = viewIndex < totalVersions - 1
  const footerStatus = state.releaseNotesLoadingVersion
    ? chalk.gray(`Loading release notes for v${state.releaseNotesLoadingVersion}`)
    : totalScrollableRows > availableForBody
      ? chalk.gray('')
      : canGoNewer || canGoOlder
        ? chalk.gray(
            [canGoNewer ? '← newer version' : null, canGoOlder ? '→ older version' : null]
              .filter((hint): hint is string => Boolean(hint))
              .join('  ·  ')
          )
        : null
  const visibleBodyRows = footerStatus ? Math.max(1, availableForBody - 1) : availableForBody
  const maxScroll = Math.max(0, totalScrollableRows - visibleBodyRows)
  const clampedOffset = Math.min(scrollOffset, maxScroll)
  const resolvedFooterStatus = state.releaseNotesLoadingVersion
    ? chalk.gray(`Loading release notes for v${state.releaseNotesLoadingVersion}`)
    : maxScroll > 0
      ? clampedOffset < maxScroll
        ? chalk.gray(
            `Lines ${clampedOffset + 1}-${Math.min(clampedOffset + visibleBodyRows, totalScrollableRows)} of ${totalScrollableRows}`
          )
        : chalk.gray('End of release notes')
      : // A truthy hint footer shrinks visibleBodyRows, which forces
        // maxScroll ≥ 1 whenever the scroll path is entered — so this arm can
        // only resolve to the hints when maxScroll is 0, which cannot happen.
        // Kept as a safety net for future layout changes.
        /* v8 ignore start */
        canGoNewer || canGoOlder
        ? chalk.gray(
            [canGoNewer ? '← newer version' : null, canGoOlder ? '→ older version' : null]
              .filter((hint): hint is string => Boolean(hint))
              .join('  ·  ')
          )
        : null
  /* v8 ignore stop */
  const visibleSlice = bodyRows.slice(clampedOffset, clampedOffset + visibleBodyRows)
  const lines: string[] = []
  const topPadding = Math.max(0, Math.floor((terminalHeight - fixedModalHeight) / 2))
  for (let i = 0; i < topPadding; i++) {
    lines.push('')
  }

  lines.push(' '.repeat(padding) + chalk.gray(`╭${'─'.repeat(modalWidth - 2)}╮`))

  fittedPinned.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      lines.push(renderModalSeparator(padding, modalWidth))
    }
    for (const row of section.rows) {
      lines.push(renderModalRow(padding, modalWidth, row))
    }
  })

  // bodySections is never empty on the scroll path (see above), so a
  // separator between the pinned rows and the body is always drawn.
  lines.push(renderModalSeparator(padding, modalWidth))

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
    // bodySections is non-empty on this path, so its separator row always counts.
    pinnedRowCount + 1 + renderedScrollRows + (resolvedFooterStatus ? 1 : 0)
  const totalContentSlots = fixedModalHeight - 2
  // The scroll path is only entered when content overflows the frame, so the
  // window is always full and there are never filler rows to add.
  /* v8 ignore start */
  const emptyRows = Math.max(0, totalContentSlots - usedContentRows)
  for (let i = 0; i < emptyRows; i++) {
    lines.push(renderModalRow(padding, modalWidth, ''))
  }
  /* v8 ignore stop */

  if (resolvedFooterStatus) {
    lines.push(renderModalRow(padding, modalWidth, resolvedFooterStatus))
  }

  lines.push(' '.repeat(padding) + chalk.gray(`╰${'─'.repeat(modalWidth - 2)}╯`))

  return {
    lines,
    maxScrollOffset: maxScroll,
    totalContentRows: totalScrollableRows,
    usesInternalScroll: true,
  }
}
