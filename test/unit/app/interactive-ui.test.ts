import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InteractiveUI } from '../../../src/app/interactive-ui'
import { runInteractiveSession } from '../../../src/features/interactive'
import { TerminalInput } from '../../../src/shared/terminal'
import {
  PackageManagerInfo,
  PackageSelectionState,
  StreamOutdatedPackagesBatchItem,
} from '../../../src/shared/types'
import { makePackageInfo } from '../../fixtures/package-info-factory'
import { makeSelectionState } from '../../fixtures/selection-state-factory'
import { installFakeStdin, type FakeStdin } from '../../helpers/fake-stdin'
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
    sessionMock.mockImplementation(async (states: PackageSelectionState[]) => {
      states[0].selectedOption = 'latest'
      return states
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
    sessionMock.mockImplementation(async (states: PackageSelectionState[]) => {
      states[0].selectedOption = 'latest'
      return states
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
    })
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

describe('InteractiveUI.appendOutdatedBatchToSelectionStates', () => {
  const batchItem = (
    name: string,
    overrides?: Partial<ReturnType<typeof makePackageInfo>>
  ): StreamOutdatedPackagesBatchItem => ({
    packageName: name,
    packageInfo: [makePackageInfo({ name, ...overrides })],
    failed: false,
  })

  it('appends new outdated packages and audits the combined list', () => {
    const ui = new InteractiveUI(npmInfo)
    const audit = vi.spyOn(ui, 'enqueueSecurityAudit')
    const selectionStates: PackageSelectionState[] = [makeSelectionState({ name: 'existing' })]

    ui.appendOutdatedBatchToSelectionStates(selectionStates, [batchItem('fresh-pkg')])

    expect(selectionStates.map((s) => s.name)).toEqual(['existing', 'fresh-pkg'])
    expect(audit).toHaveBeenCalledWith(selectionStates)
  })

  it('skips duplicates already present by name, specifier, and type', () => {
    const ui = new InteractiveUI(npmInfo)
    const selectionStates = [
      makeSelectionState({ name: 'test-pkg', currentVersionSpecifier: '^1.0.0' }),
    ]

    ui.appendOutdatedBatchToSelectionStates(selectionStates, [batchItem('test-pkg')])

    expect(selectionStates).toHaveLength(1)
  })

  it('ignores batches with nothing outdated and skips the audit', () => {
    const ui = new InteractiveUI(npmInfo)
    const audit = vi.spyOn(ui, 'enqueueSecurityAudit')
    const selectionStates: PackageSelectionState[] = []

    ui.appendOutdatedBatchToSelectionStates(selectionStates, [
      batchItem('current-pkg', { isOutdated: false }),
    ])

    expect(selectionStates).toEqual([])
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('InteractiveUI.selectPackagesToUpgradeProgressive', () => {
  it('forwards streaming progress and the refresh attachment to the session', async () => {
    const ui = new InteractiveUI(npmInfo)
    const states = [makeSelectionState({ selectedOption: 'range' })]
    const progress = { discovered: 1, resolved: 1, total: 2, failed: 0, isLoading: true }
    const attachRefresh = vi.fn()
    sessionMock.mockResolvedValue(states)

    const choices = await ui.selectPackagesToUpgradeProgressive(states, progress, attachRefresh)

    expect(sessionMock).toHaveBeenCalledTimes(1)
    expect(sessionMock.mock.calls[0][0]).toBe(states)
    expect(sessionMock.mock.calls[0][7]).toBe(progress)
    expect(sessionMock.mock.calls[0][8]).toBe(attachRefresh)
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
})
