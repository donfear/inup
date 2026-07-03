import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInteractiveSession } from '../../../../src/features/interactive/session/interactive-session'
import { UIRenderer } from '../../../../src/features/interactive/renderer'
import { themeNames } from '../../../../src/features/interactive/themes'
import type { PackageInfoModalController } from '../../../../src/features/interactive/controllers'
import type { VulnerabilityAuditController } from '../../../../src/features/audit'
import { CursorUtils, TerminalInput } from '../../../../src/shared/terminal'
import { configManager } from '../../../../src/shared/config/user-config'
import {
  PackageManagerInfo,
  PackageSelectionState,
  VulnerabilityDisplayOptions,
} from '../../../../src/shared/types'
import { makeSelectionState } from '../../../fixtures/selection-state-factory'
import { installFakeStdin, type FakeStdin } from '../../../helpers/fake-stdin'
import { captureStdout, type TerminalCapture } from '../../../helpers/terminal-capture'
import { stripAnsi } from '../../../../src/shared/terminal/text'

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
    attachRefresh?: (refresh: () => void) => void
  } = {}
) {
  const controllers = makeControllers()
  const promise = runInteractiveSession(
    states,
    npmInfo,
    new UIRenderer(),
    controllers.packageInfoModalController as unknown as PackageInfoModalController,
    controllers.vulnerabilityAuditController as unknown as VulnerabilityAuditController,
    displayOptions,
    extras.onRefreshViewReady,
    undefined,
    extras.attachRefresh
  )
  return { promise, ...controllers }
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
  stdout.restore()
  fake.restore()
  // A finished session must not leak process-level listeners.
  expect(process.listenerCount('exit')).toBe(exitListenerBaseline)
  expect(process.listenerCount('SIGWINCH')).toBe(sigwinchBaseline)
})

describe('runInteractiveSession lifecycle', () => {
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
    const states = [makeSelectionState({ selectedOption: 'latest' })]
    const { promise, vulnerabilityAuditController } = startSession(states)

    expect(vulnerabilityAuditController.enqueueStates).toHaveBeenCalledWith(
      states,
      expect.any(Function)
    )
    const onUpdate = vulnerabilityAuditController.enqueueStates.mock.calls[0][1] as () => void

    stdout.clear()
    onUpdate()
    expect(stdout.output()).not.toBe('')

    await fake.sendKeys('\r')
    await promise

    stdout.clear()
    onUpdate() // after resolution the callback must be inert
    expect(stdout.output()).toBe('')
  })

  it('hands out a refresh hook and revokes it on finalize', async () => {
    const refreshCalls: Array<(() => void) | undefined> = []
    const attached: Array<() => void> = []
    const states = [makeSelectionState({ selectedOption: 'latest' })]

    const { promise } = startSession(states, {
      onRefreshViewReady: (refresh) => refreshCalls.push(refresh),
      attachRefresh: (refresh) => attached.push(refresh),
    })

    expect(refreshCalls).toHaveLength(1)
    expect(refreshCalls[0]).toBeTypeOf('function')
    expect(attached).toHaveLength(1)

    stdout.clear()
    refreshCalls[0]!()
    expect(stdout.output()).not.toBe('')

    stdout.clear()
    attached[0]()
    expect(stdout.output()).not.toBe('')

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

    await fake.sendKeys('i')
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
