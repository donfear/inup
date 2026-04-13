import chalk from 'chalk'
import { PackageSelectionState } from '../../types'
import { getModalWidth, fitModalSections, renderModalFrame } from './layout'
import { buildPackageInfoSections } from './package-info-sections'
import { ModalSection } from './types'

export function renderPackageInfoLoading(
  state: PackageSelectionState,
  terminalWidth: number = 80,
  terminalHeight: number = 24
): string[] {
  const sections: ModalSection[] = [
    {
      key: 'loading',
      rows: [chalk.cyan('⏳ Loading package info...'), chalk.white(state.name)],
      required: true,
    },
  ]

  return renderModalFrame(sections, {
    terminalWidth,
    terminalHeight,
    minWidth: 50,
    maxWidth: 120,
  })
}

export function renderPackageInfoModal(
  state: PackageSelectionState,
  terminalWidth: number = 80,
  terminalHeight: number = 24
): string[] {
  const modalWidth = getModalWidth(terminalWidth, 60, 120)
  const sections = fitModalSections(
    buildPackageInfoSections(state, modalWidth),
    Math.max(10, terminalHeight - 2),
    ['homepage', 'changelog', 'description']
  )

  return renderModalFrame(sections, {
    terminalWidth,
    terminalHeight,
    minWidth: 60,
    maxWidth: 120,
  })
}
