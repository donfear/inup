import { describe, expect, it } from 'vitest'
import type { Key } from 'node:readline'
import { InputHandler, type InputAction } from '../../../src/ui/input-handler'
import type { StateManager } from '../../../src/ui/state'
import { PackageSelectionState } from '../../../src/shared/types'

const uiState = {
  showThemeModal: false,
  showDebugModal: false,
  showHelpModal: false,
  showInfoModal: false,
  filterMode: false,
  filterQuery: '',
}

function makeHandler() {
  const actions: InputAction[] = []
  const stateManager = { getUIState: () => uiState } as unknown as StateManager
  const handler = new InputHandler(
    stateManager,
    (action) => actions.push(action),
    () => {},
    () => {}
  )
  return { handler, actions }
}

const press = (
  handler: InputHandler,
  str: string,
  key: Partial<Key>,
  states: PackageSelectionState[] = []
) => handler.handleKeypress(str, key as Key, states)

describe('InputHandler keymap dispatch', () => {
  it('Space toggles the current selection', () => {
    const { handler, actions } = makeHandler()
    press(handler, ' ', { name: 'space' })
    expect(actions).toEqual([{ type: 'toggle_selection' }])
  })

  it('v toggles the vulnerable filter', () => {
    const { handler, actions } = makeHandler()
    press(handler, 'v', { name: 'v' })
    expect(actions).toEqual([{ type: 'toggle_vulnerable_filter' }])
  })

  it('j / k move down / up', () => {
    const { handler, actions } = makeHandler()
    press(handler, 'j', { name: 'j' })
    press(handler, 'k', { name: 'k' })
    expect(actions).toEqual([{ type: 'navigate_down' }, { type: 'navigate_up' }])
  })

  it('g jumps to top and shift+g jumps to bottom', () => {
    const { handler, actions } = makeHandler()
    press(handler, 'g', { name: 'g' })
    press(handler, 'G', { name: 'g', shift: true })
    expect(actions).toEqual([{ type: 'navigate_top' }, { type: 'navigate_bottom' }])
  })

  it('? opens the help overlay', () => {
    const { handler, actions } = makeHandler()
    press(handler, '?', {})
    expect(actions).toEqual([{ type: 'toggle_help_modal' }])
  })

  it('Enter with nothing selected emits a notice instead of confirming', () => {
    const { handler, actions } = makeHandler()
    press(handler, '\r', { name: 'return' }, [
      {
        name: 'pkg',
        packageJsonPath: '/repo/package.json',
        packageJsonPaths: ['/repo/package.json'],
        currentVersionSpecifier: '^1.0.0',
        currentVersion: '1.0.0',
        rangeVersion: '1.1.0',
        latestVersion: '2.0.0',
        selectedOption: 'none',
        loadState: 'ready',
        hasRangeUpdate: true,
        hasMajorUpdate: true,
        type: 'dependencies',
      },
    ])
    expect(actions).toEqual([{ type: 'notify_empty_selection' }])
  })
})
