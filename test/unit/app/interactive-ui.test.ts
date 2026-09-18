import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InteractiveUI } from '../../../src/app/interactive-ui'
import { runInteractiveSession, SelectionList } from '../../../src/features/interactive'
import { TerminalInput } from '../../../src/shared/terminal'
import type { PackageManagerInfo } from '../../../src/shared/types'
import { makePackageInfo } from '../../fixtures/package-info-factory'
import { makeSelectionState } from '../../fixtures/selection-state-factory'
import { type FakeStdin, installFakeStdin } from '../../helpers/fake-stdin'
import { captureStdout, type TerminalCapture } from '../../helpers/terminal-capture'

// Replace only the interactive session — the state builders and controllers
// under the same barrel stay real.
vi.mock('../../../src/features/interactive', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/features/interactive')>()
  return {
    ...original,
    runInteractiveSession: vi.fn(),
  }
})

const sessionMock = vi.mocked(runInteractiveSession)

const npmInfo: PackageManagerInfo = {
  name: 'npm',
  displayName: 'npm',
  lockFile: 'package-lock.json',
  workspaceFile: null,
  installCommand: 'npm install',
}

beforeEach(() => {
  sessionMock.mockReset()
})

describe('InteractiveUI.selectPackagesToUpgrade', () => {
  it('returns immediately when nothing is outdated', async () => {
    const ui = new InteractiveUI(npmInfo)

    const choices = await ui.selectPackagesToUpgrade([makePackageInfo({ isOutdated: false })])

    expect(choices).toEqual([])
    expect(sessionMock).not.toHaveBeenCalled()
  })

  it('maps the session result through createUpgradeChoices with prefix preservation', async () => {
    const ui = new InteractiveUI(npmInfo)
    sessionMock.mockImplementation(async (selection: SelectionList) => {
      selection.items[0].selectedOption = 'latest'
      return selection.items
    })

    const choices = await ui.selectPackagesToUpgrade([makePackageInfo()])

    expect(choices).toHaveLength(1)
    expect(choices[0]).toMatchObject({
      name: 'test-pkg',
      targetVersion: '^2.0.0',
      upgradeType: 'latest',
    })
  })

  it('writes bare versions when saveExact is enabled', async () => {
    const ui = new InteractiveUI(npmInfo, { saveExact: true })
    sessionMock.mockImplementation(async (selection: SelectionList) => {
      selection.items[0].selectedOption = 'latest'
      return selection.items
    })

    const choices = await ui.selectPackagesToUpgrade([makePackageInfo()])

    expect(choices[0].targetVersion).toBe('2.0.0')
  })

  it('passes normalized vulnerability display options to the session', async () => {
    const ui = new InteractiveUI(npmInfo, { showPeerDependencyVulnerabilities: true })
    sessionMock.mockResolvedValue([])

    await ui.selectPackagesToUpgrade([makePackageInfo()])

    const options = sessionMock.mock.calls[0][5]
    expect(options).toEqual({
      showPeerDependencyVulnerabilities: true,
      showOptionalDependencyVulnerabilities: false,
      cooldown: { heldCount: 0, unsupported: false },
    })
  })

  it('passes the inert-cooldown flag set by the runner into the session', async () => {
    const ui = new InteractiveUI(npmInfo)
    sessionMock.mockResolvedValue([])

    ui.setCooldownUnsupported(true)
    await ui.selectPackagesToUpgrade([makePackageInfo()])

    expect(sessionMock.mock.calls[0][5]).toMatchObject({
      cooldown: { unsupported: true },
    })
  })

  it('keeps the cooldown status live after the session has already started', async () => {
    // The regression this shape exists for: the picker mounts BEFORE scanning, so the
    // runner only learns what was held once packages resolve. A value copied into the
    // session's options at mount time would stay at zero for the whole run and the
    // header would never admit the cooldown was holding anything.
    const ui = new InteractiveUI(npmInfo)
    sessionMock.mockResolvedValue([])

    await ui.selectPackagesToUpgrade([makePackageInfo()])
    const options = sessionMock.mock.calls[0][5] as {
      cooldown: { heldCount: number; unsupported: boolean }
    }
    expect(options.cooldown).toEqual({ heldCount: 0, unsupported: false })

    ui.setCooldownHeldCount(4)
    ui.setCooldownUnsupported(true)

    expect(options.cooldown).toEqual({ heldCount: 4, unsupported: true })
  })

  it('passes the cooldown held count set by the runner into the session', async () => {
    const ui = new InteractiveUI(npmInfo)
    sessionMock.mockResolvedValue([])

    ui.setCooldownHeldCount(3)
    await ui.selectPackagesToUpgrade([makePackageInfo()])

    expect(sessionMock.mock.calls[0][5]).toMatchObject({ cooldown: { heldCount: 3 } })
  })
})

describe('InteractiveUI selection state builders', () => {
  it('builds ready selection states from package info', () => {
    const ui = new InteractiveUI(npmInfo)

    const states = ui.createSelectionStates([makePackageInfo()])

    expect(states).toHaveLength(1)
    expect(states[0]).toMatchObject({ name: 'test-pkg', loadState: 'ready' })
  })

  it('builds pending placeholders for streaming packages', () => {
    const ui = new InteractiveUI(npmInfo)

    const states = ui.createPendingSelectionStates([
      {
        name: 'stream-pkg',
        currentVersion: '^1.0.0',
        type: 'dependencies',
        packageJsonPath: '/repo/package.json',
      },
    ])

    expect(states[0]).toMatchObject({ name: 'stream-pkg', loadState: 'pending' })
  })
})

describe('InteractiveUI.insertOutdatedPackage', () => {
  const resolved = (name: string, overrides?: Partial<ReturnType<typeof makePackageInfo>>) => [
    makePackageInfo({ name, ...overrides }),
  ]

  it('inserts outdated rows at their sorted position and audits only those rows', () => {
    const ui = new InteractiveUI(npmInfo)
    const audit = vi.spyOn(ui, 'enqueueSecurityAudit')
    const selection = new SelectionList([makeSelectionState({ name: 'm-existing' })])

    ui.insertOutdatedPackage(selection, resolved('a-fresh'))
    ui.insertOutdatedPackage(selection, resolved('z-fresh'))

    expect(selection.items.map((s) => s.name)).toEqual(['a-fresh', 'm-existing', 'z-fresh'])
    expect(audit).toHaveBeenCalledTimes(2)
    const [queued, applyTo] = audit.mock.calls[0]
    expect(queued.map((s) => s.name)).toEqual(['a-fresh'])
    expect(applyTo).toBe(selection.items)
  })

  it('skips rows already present by name, specifier, and type, and audits nothing', () => {
    const ui = new InteractiveUI(npmInfo)
    const audit = vi.spyOn(ui, 'enqueueSecurityAudit')
    const selection = new SelectionList([
      makeSelectionState({ name: 'test-pkg', currentVersionSpecifier: '^1.0.0' }),
    ])

    ui.insertOutdatedPackage(selection, resolved('test-pkg'))

    expect(selection.length).toBe(1)
    expect(audit).not.toHaveBeenCalled()
  })

  it('ignores an up-to-date package and skips the audit', () => {
    const ui = new InteractiveUI(npmInfo)
    const audit = vi.spyOn(ui, 'enqueueSecurityAudit')
    const selection = new SelectionList()

    ui.insertOutdatedPackage(selection, resolved('current-pkg', { isOutdated: false }))

    expect(selection.items).toEqual([])
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('InteractiveUI.selectPackagesToUpgradeProgressive', () => {
  it('forwards streaming progress and the refresh attachment to the session', async () => {
    const ui = new InteractiveUI(npmInfo)
    const states = [makeSelectionState({ selectedOption: 'range' })]
    const progress = { discovered: 1, resolved: 1, total: 2, failed: 0, isLoading: true }
    const attachRefresh = vi.fn()
    const hook = { refresh: vi.fn(), abort: vi.fn() }
    sessionMock.mockImplementation(
      async (selection, _pm, _renderer, _modal, _audit, _opts, onRefreshViewReady) => {
        onRefreshViewReady?.(hook)
        onRefreshViewReady?.(undefined)
        return selection.items
      }
    )

    const choices = await ui.selectPackagesToUpgradeProgressive(
      new SelectionList(states),
      progress,
      attachRefresh
    )

    expect(sessionMock).toHaveBeenCalledTimes(1)
    expect(sessionMock.mock.calls[0][0].items).toBe(states)
    expect(sessionMock.mock.calls[0][7]).toBe(progress)
    // The session's single hook is fanned out to the streaming caller once,
    // and revoked so the runner cannot retain a stale session.
    expect(attachRefresh).toHaveBeenCalledTimes(2)
    expect(attachRefresh).toHaveBeenLastCalledWith(undefined)
    expect(attachRefresh).toHaveBeenCalledWith(hook)
    expect(choices[0].targetVersion).toBe('^1.1.0')
  })
})

describe('InteractiveUI.displayPackagesTable', () => {
  it('prints the rendered table', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await new InteractiveUI(npmInfo).displayPackagesTable([])

      expect(log).toHaveBeenCalledWith(expect.stringContaining('All packages are up to date!'))
    } finally {
      log.mockRestore()
    }
  })
})

describe('InteractiveUI.confirmUpgrade', () => {
  let fake: FakeStdin
  let stdout: TerminalCapture
  let log: ReturnType<typeof vi.spyOn>
  let exitBaseline: number

  beforeEach(() => {
    fake = installFakeStdin()
    stdout = captureStdout({ columns: 100, rows: 30, isTTY: true })
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    exitBaseline = process.listenerCount('exit')
  })

  afterEach(() => {
    log.mockRestore()
    stdout.restore()
    fake.restore()
    expect(process.listenerCount('exit')).toBe(exitBaseline)
  })

  it('resolves true on y', async () => {
    const promise = new InteractiveUI(npmInfo).confirmUpgrade([])

    await fake.sendKeys('y')

    await expect(promise).resolves.toBe(true)
    expect(fake.stdin.listenerCount('keypress')).toBe(0)
  })

  it('resolves null on n to return to selection', async () => {
    const promise = new InteractiveUI(npmInfo).confirmUpgrade([])

    await fake.sendKeys('n')

    await expect(promise).resolves.toBeNull()
  })

  it('resolves false on escape', async () => {
    const promise = new InteractiveUI(npmInfo).confirmUpgrade([])

    // A bare ESC is only decoded after readline's 25ms escapeCodeTimeout.
    await fake.sendKeys('\x1b', 50)

    await expect(promise).resolves.toBe(false)
  })

  it('falls back to the line prompt when raw mode is unavailable', async () => {
    const startSpy = vi.spyOn(TerminalInput, 'startKeypressSession').mockImplementation(() => {
      throw new Error('no tty')
    })
    const promptSpy = vi.spyOn(TerminalInput, 'promptForConfirmation').mockResolvedValue(true)

    try {
      await expect(new InteractiveUI(npmInfo).confirmUpgrade([])).resolves.toBe(true)
      expect(promptSpy).toHaveBeenCalledWith('Proceed with upgrade? [Y/n] ')
    } finally {
      promptSpy.mockRestore()
      startSpy.mockRestore()
    }
  })

  it('resolves false when the line-prompt fallback itself fails', async () => {
    const startSpy = vi.spyOn(TerminalInput, 'startKeypressSession').mockImplementation(() => {
      throw new Error('no tty')
    })
    const promptSpy = vi
      .spyOn(TerminalInput, 'promptForConfirmation')
      .mockRejectedValue(new Error('stdin closed'))

    try {
      await expect(new InteractiveUI(npmInfo).confirmUpgrade([])).resolves.toBe(false)
    } finally {
      promptSpy.mockRestore()
      startSpy.mockRestore()
    }
  })
})

describe('InteractiveUI refresh plumbing', () => {
  it('stores the refresh hook handed out by the session (one-shot select)', async () => {
    const ui = new InteractiveUI(npmInfo)
    const refresh = vi.fn()
    sessionMock.mockImplementation(
      async (selection, _pm, _renderer, _modal, _audit, _opts, onRefreshViewReady) => {
        onRefreshViewReady?.({ refresh, abort: vi.fn() })
        return selection.items
      }
    )

    await ui.selectPackagesToUpgrade([makePackageInfo()])

    // The stored hook is what the audit refresh path calls.
    const enqueueSpy = vi
      .spyOn(
        (ui as unknown as { vulnerabilityAuditController: { enqueueStates: unknown } })
          .vulnerabilityAuditController,
        'enqueueStates' as never
      )
      .mockImplementation(((_states: unknown, onUpdate?: () => void) => {
        onUpdate?.()
      }) as never)

    ui.enqueueSecurityAudit([makeSelectionState({ name: 'audited' })])

    expect(enqueueSpy).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('stores the refresh hook in the progressive flow too', async () => {
    const ui = new InteractiveUI(npmInfo)
    const refresh = vi.fn()
    sessionMock.mockImplementation(
      async (selection, _pm, _renderer, _modal, _audit, _opts, onRefreshViewReady) => {
        onRefreshViewReady?.({ refresh, abort: vi.fn() })
        return selection.items
      }
    )

    const states = [makeSelectionState({ selectedOption: 'range' })]
    const attachRefresh = vi.fn()
    await ui.selectPackagesToUpgradeProgressive(
      new SelectionList(states),
      { discovered: 1, resolved: 1, total: 1, failed: 0, isLoading: true },
      attachRefresh
    )
    expect(attachRefresh).toHaveBeenCalledWith({ refresh, abort: expect.any(Function) })

    expect(sessionMock).toHaveBeenCalledTimes(1)
  })
})
