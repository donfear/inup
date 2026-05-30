import chalk from 'chalk'
import { getModalWidth, renderModalRow, renderModalSeparator } from '../modal'
import { getHelpGroups } from '../keymap'
import { getThemeColor } from '../themes-colors'
import type { ModalRenderResult } from '../modal'

const KEY_COLUMN_WIDTH = 9

/**
 * Render the `?` help overlay with a pinned title + scrollable body, identical
 * in structure to the performance panel so it handles small terminals gracefully.
 */
export function renderHelpModal(
  terminalWidth: number,
  terminalHeight: number,
  scrollOffset: number = 0
): ModalRenderResult {
  const modalWidth = getModalWidth(terminalWidth, 54, 76)
  const padding = Math.floor((terminalWidth - modalWidth) / 2)
  const fixedModalHeight = Math.max(10, terminalHeight - 2)

  // ── Pinned header (title) ──────────────────────────────────────────────────
  const pinnedRows = [chalk.bold(getThemeColor('primary')('Keyboard Shortcuts'))]
  const pinnedRowCount = pinnedRows.length

  // ── Scrollable body (groups → bindings) ───────────────────────────────────
  const bodyRows: string[] = []
  for (const { group, bindings } of getHelpGroups()) {
    if (bodyRows.length > 0) bodyRows.push('')
    bodyRows.push(getThemeColor('textSecondary')(group))
    for (const binding of bindings) {
      bodyRows.push(
        '  ' +
          chalk.bold.white(binding.displayKeys.padEnd(KEY_COLUMN_WIDTH)) +
          getThemeColor('textSecondary')(binding.help)
      )
    }
  }

  // ── Scroll math (mirrors renderPerformanceModal) ───────────────────────────
  // frame = top border + pinned rows + separator + body rows + bottom border
  const availableForBody = Math.max(3, fixedModalHeight - 2 - pinnedRowCount - 1)
  const totalScrollableRows = bodyRows.length
  const needsScroll = totalScrollableRows > availableForBody
  const visibleBodyRows = needsScroll ? Math.max(1, availableForBody - 1) : availableForBody
  const maxScroll = Math.max(0, totalScrollableRows - visibleBodyRows)
  const clampedOffset = Math.min(Math.max(0, scrollOffset), maxScroll)
  const visibleSlice = bodyRows.slice(clampedOffset, clampedOffset + visibleBodyRows)

  // ── Render ─────────────────────────────────────────────────────────────────
  const lines: string[] = []
  const topPadding = Math.max(0, Math.floor((terminalHeight - fixedModalHeight) / 2))
  for (let i = 0; i < topPadding; i++) lines.push('')

  lines.push(' '.repeat(padding) + chalk.gray('╭' + '─'.repeat(modalWidth - 2) + '╮'))

  for (const row of pinnedRows) {
    lines.push(renderModalRow(padding, modalWidth, row))
  }

  lines.push(renderModalSeparator(padding, modalWidth))

  let renderedBodyRows = 0
  for (const row of visibleSlice) {
    lines.push(renderModalRow(padding, modalWidth, row))
    renderedBodyRows++
  }

  const footer = needsScroll
    ? chalk.gray(
        `Lines ${clampedOffset + 1}–${Math.min(clampedOffset + visibleBodyRows, totalScrollableRows)} of ${totalScrollableRows}`
      )
    : null

  const usedContentRows = pinnedRowCount + 1 + renderedBodyRows + (footer ? 1 : 0)
  const totalContentSlots = fixedModalHeight - 2
  const emptyRows = Math.max(0, totalContentSlots - usedContentRows)
  for (let i = 0; i < emptyRows; i++) lines.push(renderModalRow(padding, modalWidth, ''))

  if (footer) lines.push(renderModalRow(padding, modalWidth, footer))

  lines.push(' '.repeat(padding) + chalk.gray('╰' + '─'.repeat(modalWidth - 2) + '╯'))

  return {
    lines,
    maxScrollOffset: maxScroll,
    totalContentRows: totalScrollableRows,
    usesInternalScroll: needsScroll,
  }
}
