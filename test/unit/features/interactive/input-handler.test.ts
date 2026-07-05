import type { Key } from 'node:readline'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConfirmationInputHandler,
  type InputAction,
  InputHandler,
} from '../../../../src/features/interactive/input-handler'
import type { StateManager } from '../../../../src/features/interactive/state'
import { CursorUtils } from '../../../../src/shared/terminal'
import type { PackageSelectionState } from '../../../../src/shared/types'
import { makeSelectionState } from '../../../fixtures/selection-state-factory'

const baseUiState = {
  showThemeModal: false,
  showDebugModal: false,
  showHelpModal: false,
  showInfoModal: false,
  infoModalTab: 'info',
  filterMode: false,
  filterQuery: '',
}

function makeHandler(uiOverrides: Partial<typeof baseUiState> = {}) {
  const actions: InputAction[] = []
  const ui = { ...baseUiState, ...uiOverrides }
  const stateManager = { getUIState: () => ui } as unknown as StateManager
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const handler = new InputHandler(
    stateManager,
    (action) => actions.push(action),
    onConfirm,
    onCancel
  )
  return { handler, actions, onConfirm, onCancel }
}

const press = (
  handler: InputHandler,
  str: string,
  key: Partial<Key> | undefined,
  states: PackageSelectionState[] = []
) => handler.handleKeypress(str, key as Key, states)

// cleanup() touches the real cursor and stdin — neutralize it for every test.
beforeEach(() => {
  vi.spyOn(CursorUtils, 'cleanup').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('! opens the debug modal', () => {
    const { handler, actions } = makeHandler()
    press(handler, '!', {})
    expect(actions).toEqual([{ type: 'toggle_debug_modal' }])
  })

  it('Enter with nothing selected emits a notice instead of confirming', () => {
    const { handler, actions, onConfirm } = makeHandler()
    press(handler, '\r', { name: 'return' }, [makeSelectionState({ selectedOption: 'none' })])
    expect(actions).toEqual([{ type: 'notify_empty_selection' }])
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Enter with a selection cleans up the terminal and confirms', () => {
    const { handler, actions, onConfirm } = makeHandler()
    const states = [makeSelectionState({ selectedOption: 'latest' })]

    press(handler, '\r', { name: 'return' }, states)

    expect(actions).toEqual([])
    expect(CursorUtils.cleanup).toHaveBeenCalled()
    expect(onConfirm).toHaveBeenCalledWith(states)
  })

  it('Ctrl+C cancels and exits the process', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const { handler, onCancel } = makeHandler()

    press(handler, '\x03', { name: 'c', ctrl: true })

    expect(onCancel).toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('Escape clears an applied filter but is otherwise a no-op', () => {
    const withFilter = makeHandler({ filterQuery: 'lodash' })
    press(withFilter.handler, '\x1b', { name: 'escape' })
    expect(withFilter.actions).toEqual([{ type: 'exit_filter_mode', clearQuery: true }])

    const noFilter = makeHandler()
    press(noFilter.handler, '\x1b', { name: 'escape' })
    expect(noFilter.actions).toEqual([])
  })

  it('ignores empty input, unnamed keys, and unbound keys', () => {
    const { handler, actions } = makeHandler()

    press(handler, '', undefined)
    press(handler, 'x', {})
    press(handler, 'z', { name: 'z' })

    expect(actions).toEqual([])
  })

  it('reports terminal resizes as actions', () => {
    const { handler, actions } = makeHandler()

    handler.handleResize(42)

    expect(actions).toEqual([{ type: 'resize', height: 42 }])
  })
})

describe('InputHandler filter mode entry', () => {
  it('/ enters filter mode, preserving an existing query', () => {
    const empty = makeHandler()
    press(empty.handler, '/', {})
    expect(empty.actions).toEqual([{ type: 'enter_filter_mode', preserveQuery: false }])

    const existing = makeHandler({ filterQuery: 'react' })
    press(existing.handler, '/', {})
    expect(existing.actions).toEqual([{ type: 'enter_filter_mode', preserveQuery: true }])
  })

  it('/ applies the filter when already filtering', () => {
    const { handler, actions } = makeHandler({ filterMode: true })
    press(handler, '/', {})
    expect(actions).toEqual([{ type: 'exit_filter_mode' }])
  })
})

describe('InputHandler filter mode input', () => {
  it('escape clears the query and exits via key name or raw byte', () => {
    const byName = makeHandler({ filterMode: true })
    press(byName.handler, '', { name: 'escape' })
    expect(byName.actions).toEqual([{ type: 'exit_filter_mode', clearQuery: true }])

    const byByte = makeHandler({ filterMode: true })
    press(byByte.handler, '\x1b', {})
    expect(byByte.actions).toEqual([{ type: 'exit_filter_mode', clearQuery: true }])
  })

  it('backspace and delete both erase', () => {
    const { handler, actions } = makeHandler({ filterMode: true })
    press(handler, '', { name: 'backspace' })
    press(handler, '', { name: 'delete' })
    expect(actions).toEqual([{ type: 'filter_backspace' }, { type: 'filter_backspace' }])
  })

  it('return applies the filter and keeps the query', () => {
    const { handler, actions } = makeHandler({ filterMode: true })
    press(handler, '\r', { name: 'return' })
    expect(actions).toEqual([{ type: 'exit_filter_mode' }])
  })

  it('arrow keys keep navigating and selecting while filtering', () => {
    const { handler, actions } = makeHandler({ filterMode: true })
    press(handler, '', { name: 'up' })
    press(handler, '', { name: 'down' })
    press(handler, '', { name: 'left' })
    press(handler, '', { name: 'right' })
    expect(actions).toEqual([
      { type: 'navigate_up' },
      { type: 'navigate_down' },
      { type: 'select_left' },
      { type: 'select_right' },
    ])
  })

  it('accepts printable characters including boundaries', () => {
    const { handler, actions } = makeHandler({ filterMode: true })
    press(handler, 'a', { name: 'a' })
    press(handler, ' ', { name: 'space' })
    press(handler, '~', {})
    press(handler, '!', {})
    expect(actions).toEqual([
      { type: 'filter_input', char: 'a' },
      { type: 'filter_input', char: ' ' },
      { type: 'filter_input', char: '~' },
      { type: 'filter_input', char: '!' },
    ])
  })

  it('rejects control characters and multi-character strings', () => {
    const { handler, actions } = makeHandler({ filterMode: true })
    press(handler, '\x07', {})
    press(handler, 'ab', {})
    expect(actions).toEqual([])
  })

  it('accepts bare string input without a key object', () => {
    const { handler, actions } = makeHandler({ filterMode: true })
    press(handler, 'q', undefined)
    expect(actions).toEqual([{ type: 'filter_input', char: 'q' }])
  })

  it('rejects control characters without a key object', () => {
    const { handler, actions } = makeHandler({ filterMode: true })
    press(handler, '\x07', undefined)
    expect(actions).toEqual([])
  })
})

describe('InputHandler theme modal routing', () => {
  it('routes navigation, confirmation, and close keys', () => {
    const { handler, actions } = makeHandler({ showThemeModal: true })
    press(handler, '', { name: 'up' })
    press(handler, '', { name: 'down' })
    press(handler, '\r', { name: 'return' })
    press(handler, '', { name: 'escape' })
    press(handler, 't', { name: 't' })
    expect(actions).toEqual([
      { type: 'theme_navigate_up' },
      { type: 'theme_navigate_down' },
      { type: 'theme_confirm' },
      { type: 'toggle_theme_modal' },
      { type: 'toggle_theme_modal' },
    ])
  })

  it('swallows all other keys while open', () => {
    const { handler, actions } = makeHandler({ showThemeModal: true })
    press(handler, 'j', { name: 'j' })
    press(handler, 'x', undefined)
    expect(actions).toEqual([])
  })
})

describe('InputHandler debug modal routing', () => {
  it('closes on ! or escape and scrolls with arrows', () => {
    const { handler, actions } = makeHandler({ showDebugModal: true })
    press(handler, '!', {})
    press(handler, '', { name: 'escape' })
    press(handler, '', { name: 'up' })
    press(handler, '', { name: 'down' })
    expect(actions).toEqual([
      { type: 'toggle_debug_modal' },
      { type: 'toggle_debug_modal' },
      { type: 'scroll_debug_modal_up' },
      { type: 'scroll_debug_modal_down' },
    ])
  })

  it('swallows all other keys while open', () => {
    const { handler, actions } = makeHandler({ showDebugModal: true })
    press(handler, 'j', { name: 'j' })
    press(handler, 'q', undefined)
    expect(actions).toEqual([])
  })
})

describe('InputHandler help modal routing', () => {
  it('closes on ? or escape and scrolls with arrows', () => {
    const { handler, actions } = makeHandler({ showHelpModal: true })
    press(handler, '?', {})
    press(handler, '', { name: 'escape' })
    press(handler, '', { name: 'up' })
    press(handler, '', { name: 'down' })
    expect(actions).toEqual([
      { type: 'toggle_help_modal' },
      { type: 'toggle_help_modal' },
      { type: 'scroll_help_modal_up' },
      { type: 'scroll_help_modal_down' },
    ])
  })

  it('swallows all other keys while open', () => {
    const { handler, actions } = makeHandler({ showHelpModal: true })
    press(handler, 'j', { name: 'j' })
    press(handler, 'q', undefined)
    expect(actions).toEqual([])
  })
})

describe('InputHandler info modal routing', () => {
  it('closes on escape or i and switches tabs on tab', () => {
    const { handler, actions } = makeHandler({ showInfoModal: true })
    press(handler, '', { name: 'escape' })
    press(handler, 'i', { name: 'i' })
    press(handler, '\t', { name: 'tab' })
    expect(actions).toEqual([
      { type: 'toggle_info_modal' },
      { type: 'toggle_info_modal' },
      { type: 'switch_info_modal_tab' },
    ])
  })

  it('scrolls with up/down arrows', () => {
    const { handler, actions } = makeHandler({ showInfoModal: true })
    press(handler, '', { name: 'up' })
    press(handler, '', { name: 'down' })
    expect(actions).toEqual([{ type: 'scroll_info_modal_up' }, { type: 'scroll_info_modal_down' }])
  })

  it('navigates versions with left/right on the info tab only', () => {
    const infoTab = makeHandler({ showInfoModal: true, infoModalTab: 'info' })
    press(infoTab.handler, '', { name: 'left' })
    press(infoTab.handler, '', { name: 'right' })
    expect(infoTab.actions).toEqual([
      { type: 'navigate_info_modal_version', direction: 'newer' },
      { type: 'navigate_info_modal_version', direction: 'older' },
    ])

    const usedByTab = makeHandler({ showInfoModal: true, infoModalTab: 'usedBy' })
    press(usedByTab.handler, '', { name: 'left' })
    press(usedByTab.handler, '', { name: 'right' })
    expect(usedByTab.actions).toEqual([])
  })

  it('swallows all other keys while open', () => {
    const { handler, actions } = makeHandler({ showInfoModal: true })
    press(handler, 'j', { name: 'j' })
    press(handler, 'q', undefined)
    expect(actions).toEqual([])
  })
})

describe('ConfirmationInputHandler', () => {
  it('confirms on y or return', () => {
    const onConfirm = vi.fn()
    const handler = new ConfirmationInputHandler(onConfirm)

    handler.handleKeypress('y', { name: 'y' } as Key)
    handler.handleKeypress('\r', { name: 'return' } as Key)

    expect(onConfirm).toHaveBeenNthCalledWith(1, true)
    expect(onConfirm).toHaveBeenNthCalledWith(2, true)
    expect(CursorUtils.cleanup).toHaveBeenCalledTimes(2)
  })

  it('goes back to selection on n', () => {
    const onConfirm = vi.fn()
    new ConfirmationInputHandler(onConfirm).handleKeypress('n', { name: 'n' } as Key)

    expect(onConfirm).toHaveBeenCalledWith(null)
  })

  it('cancels on escape', () => {
    const onConfirm = vi.fn()
    new ConfirmationInputHandler(onConfirm).handleKeypress('', { name: 'escape' } as Key)

    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('cancels and exits on Ctrl+C', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const onConfirm = vi.fn()

    new ConfirmationInputHandler(onConfirm).handleKeypress('\x03', {
      name: 'c',
      ctrl: true,
    } as Key)

    expect(onConfirm).toHaveBeenCalledWith(false)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('ignores empty input, missing keys, and unmapped keys', () => {
    const onConfirm = vi.fn()
    const handler = new ConfirmationInputHandler(onConfirm)

    handler.handleKeypress('', undefined as unknown as Key)
    handler.handleKeypress('x', undefined as unknown as Key)
    handler.handleKeypress('x', { name: 'x' } as Key)

    expect(onConfirm).not.toHaveBeenCalled()
  })
})
