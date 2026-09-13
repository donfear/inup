import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VulnerabilityAuditController } from '../../../../src/features/audit'
import type { PackageInfoModalController } from '../../../../src/features/interactive/controllers'
import { UIRenderer } from '../../../../src/features/interactive/renderer'
import {
  type InteractiveSessionHandle,
  runInteractiveSession,
} from '../../../../src/features/interactive/session/interactive-session'
import { SelectionList } from '../../../../src/features/interactive/session/selection-list'
import { themeNames } from '../../../../src/features/interactive/themes'
import { configManager } from '../../../../src/shared/config/user-config'
import { CursorUtils, TerminalInput } from '../../../../src/shared/terminal'
import { stripAnsi } from '../../../../src/shared/terminal/text'
import type {
  PackageLoadProgress,
  PackageManagerInfo,
  PackageSelectionState,
  VulnerabilityDisplayOptions,
} from '../../../../src/shared/types'
import { makeSelectionState } from '../../../fixtures/selection-state-factory'
import { type FakeStdin, installFakeStdin } from '../../../helpers/fake-stdin'
import { captureStdout, type TerminalCapture } from '../../../helpers/terminal-capture'

// The session reads and persists view filters and themes through the
// configManager singleton — it must be mocked or tests would write the
// user's real ~/.config/inup/config.json.
vi.mock('../../../../src/shared/config/user-config', () => ({
  configManager: {
    getTheme: vi.fn(() => null),
    setTheme: vi.fn(),
    getFilters: vi.fn(() => null),
    setFilters: vi.fn(),
  },
}))

const npmInfo: PackageManagerInfo = {
  name: 'npm',
  displayName: 'npm',
  lockFile: 'package-lock.json',
  workspaceFile: null,
  installCommand: 'npm install',
}

const displayOptions: Required<VulnerabilityDisplayOptions> = {
  showPeerDependencyVulnerabilities: false,
  showOptionalDependencyVulnerabilities: false,
}

function makeControllers() {
  const packageInfoModalController = {
    cancel: vi.fn(),
    hydrate: vi.fn().mockResolvedValue(null),
    getVersionCount: vi.fn(() => 0),
    loadVersionAtIndex: vi.fn(),
    navigateVersion: vi.fn(() => -1),
    isVersionLoaded: vi.fn(() => true),
  }
  const vulnerabilityAuditController = {
    getProgress: vi.fn(() => ({ total: 0, completed: 0, isRunning: false, hasData: false })),
    enqueueStates: vi.fn(),
    getCachedSummary: vi.fn(() => undefined),
  }
  return { packageInfoModalController, vulnerabilityAuditController }
}

function startSession(
  states: PackageSelectionState[],
  extras: {
    onRefreshViewReady?: (refresh: (() => void) | undefined) => void
    onSessionReady?: (session: InteractiveSessionHandle | undefined) => void
    attachRefresh?: (refresh: () => void) => void
    loadingProgress?: PackageLoadProgress
    renderer?: UIRenderer
  } = {}
) {
  const controllers = makeControllers()
  const selection = new SelectionList(states)
  const promise = runInteractiveSession(
    selection,
    npmInfo,
    extras.renderer ?? new UIRenderer(),
    controllers.packageInfoModalController as unknown as PackageInfoModalController,
    controllers.vulnerabilityAuditController as unknown as VulnerabilityAuditController,
    displayOptions,
    (session) => {
      extras.onSessionReady?.(session)
      const refresh = session?.refresh
      extras.onRefreshViewReady?.(refresh)
      // InteractiveUI fans the same hook out to the streaming runner.
      if (refresh) extras.attachRefresh?.(refresh)
    },
    extras.loadingProgress
  )
  return { promise, selection, ...controllers }
}

/** The last package-list frame the renderer was asked for, by name instead of position. */
function lastFrame(render: ReturnType<typeof vi.spyOn<UIRenderer, 'renderInterface'>>) {
  const call = render.mock.lastCall!
  return { states: call[0], row: call[1], scroll: call[2], options: call[14] }
}

let fake: FakeStdin
let stdout: TerminalCapture
let exitListenerBaseline: number
let sigwinchBaseline: number

beforeEach(() => {
  fake = installFakeStdin()
  stdout = captureStdout({ columns: 100, rows: 30, isTTY: true })
  exitListenerBaseline = process.listenerCount('exit')
  sigwinchBaseline = process.listenerCount('SIGWINCH')
  vi.mocked(configManager.setFilters).mockClear()
  vi.mocked(configManager.setTheme).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  stdout.restore()
  fake.restore()
  // A finished session must not leak process-level listeners.
  expect(process.listenerCount('exit')).toBe(exitListenerBaseline)
  expect(process.listenerCount('SIGWINCH')).toBe(sigwinchBaseline)
})

describe('runInteractiveSession lifecycle', () => {
  it.each(['discovering', 'collecting'] as const)(
    'renders %s before any package arrives and quits cleanly',
    async (phase) => {
      const { promise } = startSession([], {
        loadingProgress: {
          phase,
          packageJsonFiles: 3,
          discovered: 0,
          resolved: 0,
          total: 0,
          failed: 0,
          isLoading: true,
        },
      })
      const frame = stripAnsi(stdout.output())
      expect(frame).toContain('inup')
      expect(frame).toContain(
        phase === 'discovering' ? 'Scanning for package.json' : 'Reading dependencies from 3'
      )
      expect(frame).not.toContain('Showing all 0 packages')
      await fake.sendKeys('\r')
      expect(fake.stdin.listenerCount('keypress')).toBeGreaterThan(0)
      await fake.sendKeys('q')
      expect(await promise).toEqual([])
      expect(stdout.output()).toContain('\x1b[?1049l')
      expect(fake.stdin.listenerCount('keypress')).toBe(0)
    }
  )

  it('abort releases the terminal, revokes the handle, and rejects once', async () => {
    const handles: Array<InteractiveSessionHandle | undefined> = []
    const { promise } = startSession([], { onSessionReady: (handle) => handles.push(handle) })
    const handle = handles[0]!
    const error = new Error('scan failed')
    const rejected = expect(promise).rejects.toBe(error)
    handle.refresh()
    handle.abort(error)
    await rejected
    expect(handles).toEqual([handle, undefined])
    expect(stdout.output()).toContain('\x1b[?1049l')
    expect(fake.stdin.listenerCount('keypress')).toBe(0)
    expect(fake.stdin.setRawMode).toHaveBeenLastCalledWith(false)
    stdout.clear()
    handle.abort(new Error('late failure'))
    handle.refresh()
    expect(stdout.output()).toBe('')
  })
  it('confirms a pre-selected package on Enter and restores the terminal', async () => {
    const states = [makeSelectionState({ selectedOption: 'latest' })]
    const { promise } = startSession(states)

    await fake.sendKeys('\r')
    const result = await promise

    expect(result).toBe(states)
    expect(result[0].selectedOption).toBe('latest')
    expect(stdout.output()).toContain('\x1b[?1049h') // alternate screen claimed
    expect(stdout.output()).toContain('\x1b[?1049l') // ...and released
    expect(configManager.setFilters).toHaveBeenCalledTimes(1)
    expect(fake.stdin.listenerCount('keypress')).toBe(0)
  })

  it('renders the package list into the alternate screen', async () => {
    const states = [makeSelectionState({ name: 'render-me', selectedOption: 'latest' })]
    const { promise } = startSession(states)

    expect(stripAnsi(stdout.output())).toContain('render-me')

    await fake.sendKeys('\r')
    await promise
  })

  it('selects a package by keyboard and resolves with the selection', async () => {
    const states = [makeSelectionState({ name: 'pkg-a' }), makeSelectionState({ name: 'pkg-b' })]
    const { promise } = startSession(states)

    await fake.sendKeys('\x1b[B') // down to pkg-b
    await fake.sendKeys(' ') // toggle selection (best available: latest)
    await fake.sendKeys('\r') // confirm

    const result = await promise
    expect(result[0].selectedOption).toBe('none')
    expect(result[1].selectedOption).toBe('latest')
  })

  it('clears every selection when cancelled with Ctrl+C', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const states = [
      makeSelectionState({ name: 'pkg-a', selectedOption: 'latest' }),
      makeSelectionState({ name: 'pkg-b', selectedOption: 'range' }),
    ]
    const { promise, packageInfoModalController } = startSession(states)

    await fake.sendKeys('\x03')

    const result = await promise
    expect(result.every((s) => s.selectedOption === 'none')).toBe(true)
    expect(packageInfoModalController.cancel).toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(0)
    exit.mockRestore()
  })

  it('starts a vulnerability audit whose progress callback re-renders until resolved', async () => {
    const renderer = new UIRenderer()
    const render = vi.spyOn(renderer, 'renderInterface')
    const states = [makeSelectionState({ selectedOption: 'latest' })]
    const { promise, vulnerabilityAuditController } = startSession(states, { renderer })

    expect(vulnerabilityAuditController.enqueueStates).toHaveBeenCalledWith(
      states,
      expect.any(Function)
    )
    const onUpdate = vulnerabilityAuditController.enqueueStates.mock.calls[0][1] as () => void

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const framesBefore = render.mock.calls.length
    stdout.clear()
    onUpdate()
    expect(render).toHaveBeenCalledTimes(framesBefore) // coalesced, never immediate
    vi.advanceTimersByTime(16)
    expect(render).toHaveBeenCalledTimes(framesBefore + 1)
    // Nothing on screen changed, so the diffed frame wrote nothing.
    expect(stdout.output()).toBe('')
    vi.useRealTimers()

    await fake.sendKeys('\r')
    await promise

    const framesAtExit = render.mock.calls.length
    onUpdate() // after resolution the callback must be inert
    expect(render).toHaveBeenCalledTimes(framesAtExit)
  })

  it('hands out one refresh hook, shared by arrivals and audits, and revokes it on finalize', async () => {
    const renderer = new UIRenderer()
    const render = vi.spyOn(renderer, 'renderInterface')
    const refreshCalls: Array<(() => void) | undefined> = []
    const attached: Array<() => void> = []
    const states = [makeSelectionState({ selectedOption: 'latest' })]

    const { promise } = startSession(states, {
      renderer,
      onRefreshViewReady: (refresh) => refreshCalls.push(refresh),
      attachRefresh: (refresh) => attached.push(refresh),
    })

    expect(refreshCalls).toHaveLength(1)
    expect(refreshCalls[0]).toBeTypeOf('function')
    expect(attached).toEqual([refreshCalls[0]])

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const framesBefore = render.mock.calls.length
    refreshCalls[0]!()
    vi.advanceTimersByTime(16)
    expect(render).toHaveBeenCalledTimes(framesBefore + 1)
    vi.useRealTimers()

    await fake.sendKeys('\r')
    await promise

    expect(refreshCalls).toEqual([expect.any(Function), undefined])
  })

  it('re-renders when the terminal is resized', async () => {
    const states = [makeSelectionState({ selectedOption: 'latest' })]
    const { promise } = startSession(states)

    stdout.clear()
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 40 })
    process.emit('SIGWINCH')

    expect(stdout.output()).not.toBe('')

    await fake.sendKeys('\r')
    await promise
  })
})

describe('runInteractiveSession modals', () => {
  it('opens and closes the package info modal with i', async () => {
    const states = [makeSelectionState({ name: 'info-pkg', selectedOption: 'latest' })]
    const { promise, packageInfoModalController } = startSession(states)

    await fake.sendKeys('i')
    expect(packageInfoModalController.hydrate).toHaveBeenCalledWith(states[0])
    expect(stripAnsi(stdout.output())).toContain('info-pkg')

    await fake.sendKeys('i')
    expect(packageInfoModalController.cancel).toHaveBeenCalled()

    await fake.sendKeys('\r')
    await promise
  })

  it('scrolls the info modal viewport without crashing', async () => {
    const states = [makeSelectionState({ name: 'scroll-pkg', selectedOption: 'latest' })]
    const { promise } = startSession(states)

    await fake.sendKeys('i')
    await fake.sendKeys('\x1b[B') // scroll down inside the modal
    await fake.sendKeys('\x1b[A') // and back up
    await fake.sendKeys('i')

    await fake.sendKeys('\r')
    await promise
  })

  it('shows and hides the help overlay with ?', async () => {
    const states = [makeSelectionState({ selectedOption: 'latest' })]
    const { promise } = startSession(states)

    await fake.sendKeys('?')
    expect(stripAnsi(stdout.output())).toContain('Keyboard Shortcuts')

    await fake.sendKeys('\x1b[B') // scroll the overlay without crashing
    await fake.sendKeys('?')

    await fake.sendKeys('\r')
    await promise
  })

  it('shows the performance modal with ! and scrolls it', async () => {
    const states = [makeSelectionState({ selectedOption: 'latest' })]
    const { promise } = startSession(states)

    await fake.sendKeys('!')
    expect(stripAnsi(stdout.output())).toContain('⚡ Performance')

    await fake.sendKeys('\x1b[B')
    await fake.sendKeys('!')

    await fake.sendKeys('\r')
    await promise
  })

  it('previews and confirms a theme through the theme modal', async () => {
    const states = [makeSelectionState({ selectedOption: 'latest' })]
    const { promise } = startSession(states)

    await fake.sendKeys('t')
    await fake.sendKeys('\x1b[B') // preview the next theme
    await fake.sendKeys('\r') // confirm it

    expect(configManager.setTheme).toHaveBeenCalledWith(themeNames[1])

    await fake.sendKeys('\r')
    await promise
  })
})

describe('runInteractiveSession fallback', () => {
  it('rejects initial rendering failures after restoring raw mode and the alternate screen', async () => {
    const renderer = new UIRenderer()
    vi.spyOn(renderer, 'renderInterface').mockImplementation(() => {
      throw new Error('first frame failed')
    })
    const { promise } = startSession([], { renderer })
    await expect(promise).rejects.toThrow('first frame failed')
    expect(fake.stdin.listenerCount('keypress')).toBe(0)
    expect(fake.stdin.setRawMode).toHaveBeenLastCalledWith(false)
    expect(stdout.output()).toContain('\x1b[?1049l')
  })
  it('resolves immediately with the original states when raw mode is unavailable', async () => {
    const startSpy = vi.spyOn(TerminalInput, 'startKeypressSession').mockImplementation(() => {
      throw new Error('raw mode unavailable')
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const refreshCalls: Array<(() => void) | undefined> = []

    try {
      const states = [makeSelectionState({ selectedOption: 'range' })]
      const { promise } = startSession(states, {
        onRefreshViewReady: (refresh) => refreshCalls.push(refresh),
      })

      const result = await promise

      expect(result).toBe(states)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('fallback interface'))
      expect(refreshCalls).toEqual([expect.any(Function), undefined])
      expect(stdout.output()).toContain('\x1b[?1049l') // alt screen released on failure
    } finally {
      log.mockRestore()
      startSpy.mockRestore()
    }
  })

  it('falls back cleanly when even claiming the alternate screen fails', async () => {
    const enterSpy = vi.spyOn(CursorUtils, 'enterAlternateScreen').mockImplementation(() => {
      throw new Error('not a terminal')
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const states = [makeSelectionState({ selectedOption: 'range' })]
      const { promise } = startSession(states)

      const result = await promise

      expect(result).toBe(states)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('fallback interface'))
      // The alternate screen was never claimed, so it must not be "released".
      expect(stdout.output()).not.toContain('\x1b[?1049l')
    } finally {
      log.mockRestore()
      enterSpy.mockRestore()
    }
  })
})

describe('runInteractiveSession edge paths', () => {
  it('renders every modal with fallback dimensions when the terminal reports no size', async () => {
    stdout.restore()
    stdout = captureStdout({ columns: 0, rows: 0, isTTY: true })

    const states = [makeSelectionState({ name: 'fallback-pkg', selectedOption: 'latest' })]
    const { promise } = startSession(states)

    await fake.sendKeys('t') // theme modal
    await fake.sendKeys('\r') // confirm current theme
    await fake.sendKeys('?') // help modal
    await fake.sendKeys('?')
    await fake.sendKeys('!') // performance modal
    await fake.sendKeys('!')
    await fake.sendKeys('i') // info modal
    await fake.sendKeys('i')
    await fake.sendKeys('\r')
    await promise

    expect(stripAnsi(stdout.output())).toContain('fallback-pkg')
  })

  it('omits scroll hints when the modals fit a tall terminal', async () => {
    stdout.restore()
    stdout = captureStdout({ columns: 120, rows: 100, isTTY: true })

    const states = [makeSelectionState({ name: 'tall-pkg', selectedOption: 'latest' })]
    const { promise } = startSession(states)

    await fake.sendKeys('?')
    await fake.sendKeys('?')
    await fake.sendKeys('!')
    await fake.sendKeys('!')
    await fake.sendKeys('i')
    await fake.sendKeys('\t') // switch to the Used-by tab
    await fake.sendKeys('\t') // and back to Info
    await fake.sendKeys('i')
    await fake.sendKeys('\r')
    await promise

    expect(stripAnsi(stdout.output())).toContain('tall-pkg')
  })

  it('shows the scroll hint for long release notes and re-paints embedded resets', async () => {
    const noisyNotes = [
      '## Changes',
      `- includes a raw \x1b[0m reset escape`,
      ...Array.from({ length: 60 }, (_, i) => `- change number ${i}`),
    ].join('\n')
    const states = [
      makeSelectionState({
        name: 'notes-pkg',
        selectedOption: 'latest',
        releaseNotesVersions: ['9.9.9'],
        releaseNotesLoaded: new Map([['9.9.9', noisyNotes]]),
        releaseNotesViewIndex: 0,
      }),
    ]
    const { promise } = startSession(states)

    await fake.sendKeys('i', 20)
    await fake.sendKeys('\x1b[B') // scroll inside the modal
    await fake.sendKeys('i')
    await fake.sendKeys('\r')
    await promise

    expect(stripAnsi(stdout.output())).toContain('change number')
  })

  it('ignores refresh callbacks that arrive after the session resolved', async () => {
    const refreshCalls: Array<(() => void) | undefined> = []
    const attached: Array<() => void> = []
    const states = [makeSelectionState({ selectedOption: 'latest' })]

    const { promise } = startSession(states, {
      onRefreshViewReady: (refresh) => refreshCalls.push(refresh),
      attachRefresh: (refresh) => attached.push(refresh),
    })

    await fake.sendKeys('\r')
    await promise

    stdout.clear()
    refreshCalls[0]!()
    attached[0]()
    expect(stdout.output()).toBe('')
  })
})

describe('progressive rendering', () => {
  it('coalesces background arrivals and lets keyboard input consume a pending frame', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const renderer = new UIRenderer()
    const render = vi.spyOn(renderer, 'renderInterface')
    let refresh!: () => void
    const states = [makeSelectionState({ name: 'a' }), makeSelectionState({ name: 'b' })]
    const { promise } = startSession(states, {
      renderer,
      attachRefresh: (fn) => {
        refresh = fn
      },
    })
    render.mockClear()
    for (let i = 0; i < 10; i++) refresh()
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(15)
    expect(render).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(render).toHaveBeenCalledTimes(1)

    refresh()
    fake.stdin.emit('keypress', '', { name: 'down' })
    expect(render).toHaveBeenCalledTimes(2)
    expect(lastFrame(render).row).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(16)
    expect(render).toHaveBeenCalledTimes(2)
    fake.stdin.emit('keypress', ' ', { name: 'space' })
    refresh()
    fake.stdin.emit('keypress', '', { name: 'return' })
    expect((await promise)[1].selectedOption).toBe('latest')
    expect(vi.getTimerCount()).toBe(0)
    const frames = render.mock.calls.length
    refresh()
    vi.advanceTimersByTime(100)
    expect(render).toHaveBeenCalledTimes(frames)
  })

  it('keeps focused/scrolled rows and selections fixed as packages append and loading completes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const renderer = new UIRenderer()
    const render = vi.spyOn(renderer, 'renderInterface')
    const states = Array.from({ length: 35 }, (_, i) =>
      makeSelectionState({ name: `pkg-${String(i).padStart(2, '0')}` })
    )
    const originals = [...states]
    const progress = { discovered: 40, total: 40, resolved: 35, failed: 0, isLoading: true }
    let refresh!: () => void
    const { promise, selection } = startSession(states, {
      renderer,
      loadingProgress: progress,
      attachRefresh: (fn) => {
        refresh = fn
      },
    })
    for (let i = 0; i < 28; i++) fake.stdin.emit('keypress', '', { name: 'down' })
    fake.stdin.emit('keypress', ' ', { name: 'space' })
    const { row, scroll } = lastFrame(render)
    expect(scroll).toBeGreaterThan(0)
    for (let i = 35; i < 40; i++) {
      selection.insert([makeSelectionState({ name: `pkg-${i}` })])
      refresh()
    }
    vi.advanceTimersByTime(16)
    expect(lastFrame(render).row).toBe(row)
    expect(lastFrame(render).scroll).toBe(scroll)
    for (const [index, state] of originals.entries()) expect(states[index]).toBe(state)
    expect(states[row].selectedOption).toBe('latest')

    stdout.clear()
    progress.resolved = 40
    progress.isLoading = false
    refresh()
    vi.advanceTimersByTime(16)
    expect(stdout.output()).not.toBe('')
    expect(stripAnsi(stdout.output())).not.toContain('Loading packages...')
    fake.stdin.emit('keypress', '', { name: 'return' })
    expect(await promise).toBe(states)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('re-fits column widths only when a wider row arrives or the terminal resizes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const renderer = new UIRenderer()
    const render = vi.spyOn(renderer, 'renderInterface')
    const widths = () => lastFrame(render).options!.columnWidths
    const states = [makeSelectionState({ selectedOption: 'range' })]
    let refresh!: () => void
    const { promise, selection, vulnerabilityAuditController } = startSession(states, {
      renderer,
      attachRefresh: (fn) => {
        refresh = fn
      },
    })
    const original = widths()
    fake.stdin.emit('keypress', '', { name: 'down' })
    fake.stdin.emit('keypress', '', { name: 'right' })
    expect(widths()).toBe(original)
    selection.insert([
      makeSelectionState({
        name: 'z',
        type: 'devDependencies',
        currentVersionSpecifier: '^16.0.0-preview.10',
      }),
    ])
    refresh()
    vi.advanceTimersByTime(16)
    const widened = widths()
    expect(widened).not.toBe(original)
    expect(widened.current).toBeGreaterThan(original.current)
    // Filtering narrows the rows on screen but never moves the columns.
    fake.stdin.emit('keypress', 'd', { name: 'd' })
    expect(widths()).toBe(widened)
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 120 })
    process.emit('SIGWINCH')
    const resized = widths()
    expect(resized).not.toBe(widened)
    // Audit results change badges, never version columns: no remeasure.
    const onAudit = vulnerabilityAuditController.enqueueStates.mock.calls[0][1] as () => void
    onAudit()
    vi.advanceTimersByTime(16)
    expect(widths()).toBe(resized)
    fake.stdin.emit('keypress', '', { name: 'return' })
    await promise
  })

  it('keeps the focused package under the cursor, on the same screen line, as rows insert above', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const renderer = new UIRenderer()
    const render = vi.spyOn(renderer, 'renderInterface')
    const states = Array.from({ length: 35 }, (_, i) =>
      makeSelectionState({ name: `pkg-${String(i).padStart(2, '0')}` })
    )
    let refresh!: () => void
    const { promise, selection } = startSession(states, {
      renderer,
      attachRefresh: (fn) => {
        refresh = fn
      },
    })
    for (let i = 0; i < 28; i++) fake.stdin.emit('keypress', '', { name: 'down' })
    fake.stdin.emit('keypress', ' ', { name: 'space' })
    const { states: before, row, scroll } = lastFrame(render)
    const focused = before[row]
    expect(focused.name).toBe('pkg-28')
    expect(scroll).toBeGreaterThan(0)

    // Two rows sort before every pkg-*: both land above the cursor.
    selection.insert([makeSelectionState({ name: 'aaa-0' }), makeSelectionState({ name: 'aaa-1' })])
    refresh()
    vi.advanceTimersByTime(16)

    const { states: visible, row: newRow, scroll: newScroll } = lastFrame(render)
    expect(visible[newRow]).toBe(focused)
    expect(newRow).toBe(row + 2)
    expect(newScroll).toBe(scroll + 2) // same screen line
    expect(newRow - newScroll).toBe(row - scroll)

    // The next keypress acts on the focused package, not on a stale index.
    fake.stdin.emit('keypress', ' ', { name: 'space' })
    expect(focused.selectedOption).toBe('none')
    fake.stdin.emit('keypress', ' ', { name: 'space' })
    expect(focused.selectedOption).toBe('latest')
    fake.stdin.emit('keypress', '', { name: 'return' })
    expect((await promise)[newRow]).toBe(focused)
  })

  it('lets the list grow visibly while the viewport is at the top', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const renderer = new UIRenderer()
    const render = vi.spyOn(renderer, 'renderInterface')
    const states = [
      makeSelectionState({ name: 'b' }),
      makeSelectionState({ name: 'c' }),
      makeSelectionState({ name: 'd' }),
    ]
    let refresh!: () => void
    const { promise, selection } = startSession(states, {
      renderer,
      attachRefresh: (fn) => {
        refresh = fn
      },
    })
    fake.stdin.emit('keypress', '', { name: 'down' })
    fake.stdin.emit('keypress', '', { name: 'down' })
    const focused = lastFrame(render).states[2]
    expect(focused.name).toBe('d')

    selection.insert([makeSelectionState({ name: 'a' })])
    refresh()
    vi.advanceTimersByTime(16)

    const { states: visible, row, scroll } = lastFrame(render)
    expect(visible.map((s) => s.name)).toEqual(['a', 'b', 'c', 'd'])
    expect(visible[row]).toBe(focused)
    expect(row).toBe(3)
    expect(scroll).toBe(0)
    fake.stdin.emit('keypress', ' ', { name: 'space' })
    fake.stdin.emit('keypress', '', { name: 'return' })
    expect(focused.selectedOption).toBe('latest')
    await promise
  })

  it('pins the cursor to the top row until the user touches the keyboard', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const renderer = new UIRenderer()
    const render = vi.spyOn(renderer, 'renderInterface')
    let refresh!: () => void
    const { promise, selection } = startSession([makeSelectionState({ name: 'm' })], {
      renderer,
      attachRefresh: (fn) => {
        refresh = fn
      },
    })

    selection.insert([makeSelectionState({ name: 'a' })])
    refresh()
    vi.advanceTimersByTime(16)

    const { states: visible, row } = lastFrame(render)
    expect(row).toBe(0)
    expect(visible[0].name).toBe('a')
    fake.stdin.emit('keypress', ' ', { name: 'space' })
    fake.stdin.emit('keypress', '', { name: 'return' })
    expect(visible[0].selectedOption).toBe('latest')
    await promise
  })

  it('keeps an open info modal on its package when rows insert above it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const renderer = new UIRenderer()
    const modal = vi.spyOn(renderer, 'renderPackageInfoModal')
    const states = [makeSelectionState({ name: 'b' }), makeSelectionState({ name: 'c' })]
    let refresh!: () => void
    const { promise, selection } = startSession(states, {
      renderer,
      attachRefresh: (fn) => {
        refresh = fn
      },
    })
    fake.stdin.emit('keypress', '', { name: 'down' })
    fake.stdin.emit('keypress', 'i', { name: 'i' })
    await Promise.resolve() // hydrate resolves
    await Promise.resolve()
    vi.advanceTimersByTime(16)
    expect(modal.mock.lastCall![0].name).toBe('c')

    selection.insert([makeSelectionState({ name: 'a' })])
    refresh()
    vi.advanceTimersByTime(16)
    expect(modal.mock.lastCall![0].name).toBe('c')

    fake.stdin.emit('keypress', 'i', { name: 'i' })
    fake.stdin.emit('keypress', ' ', { name: 'space' })
    fake.stdin.emit('keypress', '', { name: 'return' })
    await promise
  })

  it('writes only the lines that changed once a full frame is on screen', async () => {
    const states = Array.from({ length: 5 }, (_, i) => makeSelectionState({ name: `pkg-${i}` }))
    const { promise } = startSession(states)
    const fullFrame = stdout.output()
    expect(fullFrame).toContain('\x1b[2J') // first frame clears and paints everything
    // biome-ignore lint/suspicious/noControlCharactersInRegex: counts cursor-addressing escapes
    const addressed = (text: string) => text.match(/\x1b\[\d+;1H/g)?.length ?? 0
    expect(addressed(fullFrame)).toBe(0)

    stdout.clear()
    fake.stdin.emit('keypress', '', { name: 'down' })
    const diff = stdout.output()
    // Two package rows swap highlight and the status line changes; nothing else.
    expect(addressed(diff)).toBeGreaterThan(0)
    expect(addressed(diff)).toBeLessThanOrEqual(3)
    expect(diff).not.toContain('\x1b[2J')
    expect(diff.length).toBeLessThan(fullFrame.length / 2)

    stdout.clear()
    fake.stdin.emit('keypress', '', { name: 'up' })
    fake.stdin.emit('keypress', '', { name: 'up' }) // wraps to the bottom: scroll unchanged, rows differ
    expect(addressed(stdout.output())).toBeGreaterThan(0)

    // A resize repaints everything.
    stdout.clear()
    process.emit('SIGWINCH')
    expect(stdout.output()).toContain('\x1b[2J')
    expect(addressed(stdout.output())).toBe(0)

    fake.stdin.emit('keypress', ' ', { name: 'space' })
    fake.stdin.emit('keypress', '', { name: 'return' })
    await promise
  })

  it('rejects the session and restores the terminal when a keyboard frame throws', async () => {
    const { promise } = startSession([makeSelectionState()])
    const boom = vi.spyOn(UIRenderer.prototype, 'renderInterface').mockImplementation(() => {
      throw new Error('renderer exploded on keypress')
    })
    try {
      stdout.clear()
      fake.stdin.emit('keypress', '', { name: 'down' })
      await expect(promise).rejects.toThrow('renderer exploded on keypress')
      expect(stdout.output()).toContain('\x1b[?1049l')
      expect(fake.stdin.listenerCount('keypress')).toBe(0)
    } finally {
      boom.mockRestore()
    }
  })

  it('rejects the session and restores the terminal when a background frame throws', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const renderer = new UIRenderer()
    let refresh!: () => void
    const { promise } = startSession([makeSelectionState()], {
      attachRefresh: (fn) => {
        refresh = fn
      },
    })
    vi.spyOn(renderer, 'renderInterface')
    const original = UIRenderer.prototype.renderInterface
    const boom = vi.spyOn(UIRenderer.prototype, 'renderInterface').mockImplementation(function (
      this: UIRenderer,
      ...args
    ) {
      // Keyboard frames still render; only the coalesced background frame fails.
      if (failNext) throw new Error('renderer exploded')
      return original.apply(this, args)
    })
    let failNext = false
    try {
      fake.stdin.emit('keypress', '', { name: 'down' })
      failNext = true
      stdout.clear()
      refresh()
      const rejection = expect(promise).rejects.toThrow('renderer exploded')
      vi.advanceTimersByTime(16)
      await rejection
      expect(stdout.output()).toContain('\x1b[?1049l') // alternate screen released
      expect(fake.stdin.listenerCount('keypress')).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
      // The failed session is inert afterwards.
      refresh()
      vi.advanceTimersByTime(16)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      boom.mockRestore()
    }
  })

  it('cancels a scheduled frame if terminal setup falls back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const start = vi.spyOn(TerminalInput, 'startKeypressSession').mockImplementation(() => {
      throw new Error('raw mode unavailable')
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const { promise } = startSession([], { attachRefresh: (refresh) => refresh() })
      await promise
      expect(vi.getTimerCount()).toBe(0)
      stdout.clear()
      vi.advanceTimersByTime(16)
      expect(stdout.output()).toBe('')
    } finally {
      start.mockRestore()
      log.mockRestore()
    }
  })
})
