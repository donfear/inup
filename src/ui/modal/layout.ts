import chalk from 'chalk'
import { ModalSection } from './types'
import { getVisualLength } from '../utils'

export interface RenderModalOptions {
  terminalWidth: number
  terminalHeight: number
  minWidth: number
  maxWidth: number
}

export function getModalWidth(terminalWidth: number, minWidth: number, maxWidth: number): number {
  return Math.min(Math.max(minWidth, terminalWidth - 6), maxWidth)
}

export function renderModalRow(padding: number, modalWidth: number, text: string): string {
  const rowLength = getVisualLength(text)
  const rowPadding = Math.max(0, modalWidth - 4 - rowLength)

  return (
    ' '.repeat(padding) +
    chalk.gray('│') +
    ' ' +
    text +
    ' '.repeat(rowPadding) +
    ' ' +
    chalk.gray('│')
  )
}

export function renderModalSeparator(padding: number, modalWidth: number): string {
  return ' '.repeat(padding) + chalk.gray('├' + '─'.repeat(modalWidth - 2) + '┤')
}

export function fitModalSections(
  sections: ModalSection[],
  maxHeight: number,
  trimOrder: string[]
): ModalSection[] {
  const activeSections = sections.map((section) => ({ ...section, rows: [...section.rows] }))

  while (getModalFrameHeight(activeSections) > maxHeight) {
    let trimmed = false

    for (const key of trimOrder) {
      const section = activeSections.find(
        (candidate) => candidate.key === key && candidate.rows.length > 0 && !candidate.required
      )
      if (!section) {
        continue
      }

      if (section.rows.length === 1) {
        section.rows = []
      } else {
        section.rows = section.rows.slice(0, -1)
      }
      trimmed = true
      break
    }

    if (!trimmed) {
      break
    }
  }

  return activeSections.filter((section) => section.rows.length > 0)
}

export function getModalSectionRowCount(sections: ModalSection[]): number {
  const visible = sections.filter((section) => section.rows.length > 0)
  return visible.reduce((sum, section, index) => sum + section.rows.length + (index > 0 ? 1 : 0), 0)
}

export function getModalFrameHeight(sections: ModalSection[]): number {
  return 2 + getModalSectionRowCount(sections)
}

export function renderModalFrame(sections: ModalSection[], options: RenderModalOptions): string[] {
  const modalWidth = getModalWidth(options.terminalWidth, options.minWidth, options.maxWidth)
  const padding = Math.floor((options.terminalWidth - modalWidth) / 2)
  const contentHeight = getModalFrameHeight(sections)
  const topPadding = Math.max(0, Math.floor((options.terminalHeight - contentHeight) / 2))
  const lines: string[] = []

  for (let i = 0; i < topPadding; i++) {
    lines.push('')
  }

  lines.push(' '.repeat(padding) + chalk.gray('╭' + '─'.repeat(modalWidth - 2) + '╮'))

  sections.forEach((section, index) => {
    if (index > 0) {
      lines.push(renderModalSeparator(padding, modalWidth))
    }

    section.rows.forEach((row) => {
      lines.push(renderModalRow(padding, modalWidth, row))
    })
  })

  lines.push(' '.repeat(padding) + chalk.gray('╰' + '─'.repeat(modalWidth - 2) + '╯'))

  return lines
}
