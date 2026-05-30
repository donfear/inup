import chalk from 'chalk'
import { renderModalFrame, type ModalSection } from '../modal'
import { getHelpGroups } from '../keymap'
import { getThemeColor } from '../themes-colors'

const KEY_COLUMN_WIDTH = 9

/**
 * Render the `?` help overlay. Content is derived entirely from the keymap, so it
 * can never disagree with what the keys actually do. Reuses the shared modal
 * frame toolkit (the same one the performance panel uses).
 */
export function renderHelpModal(terminalWidth: number, terminalHeight: number): string[] {
  const sections: ModalSection[] = [
    {
      key: 'title',
      rows: [chalk.bold(getThemeColor('primary')('⌨  Keyboard Shortcuts'))],
    },
    ...getHelpGroups().map(({ group, bindings }) => ({
      key: group,
      rows: [
        getThemeColor('textSecondary')(group),
        ...bindings.map(
          (binding) =>
            '  ' +
            chalk.bold.white(binding.displayKeys.padEnd(KEY_COLUMN_WIDTH)) +
            getThemeColor('textSecondary')(binding.help)
        ),
      ],
    })),
  ]

  return renderModalFrame(sections, {
    terminalWidth,
    terminalHeight,
    minWidth: 52,
    maxWidth: 76,
  })
}
