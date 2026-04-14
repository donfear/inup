import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  upgradeRunnerRun: vi.fn(),
  loadProjectConfig: vi.fn(),
  checkForUpdateAsync: vi.fn(),
  getGitWorkingTreeState: vi.fn(),
  promptForConfirmation: vi.fn(),
}))

vi.mock('../../src/index', () => ({
  UpgradeRunner: class {
    run = mocks.upgradeRunnerRun
  },
}))

vi.mock('../../src/config', () => ({
  loadProjectConfig: mocks.loadProjectConfig,
}))

vi.mock('../../src/services', () => ({
  checkForUpdateAsync: mocks.checkForUpdateAsync,
}))

vi.mock('../../src/utils/git', () => ({
  getGitWorkingTreeState: mocks.getGitWorkingTreeState,
}))

vi.mock('../../src/ui/utils/terminal-input', () => ({
  TerminalInput: {
    promptForConfirmation: mocks.promptForConfirmation,
  },
}))

import { runCli } from '../../src/cli'

describe('CLI git dirty preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.loadProjectConfig.mockReturnValue({})
    mocks.checkForUpdateAsync.mockResolvedValue(null)
    mocks.getGitWorkingTreeState.mockReturnValue({ isRepo: false, isDirty: false })
    mocks.promptForConfirmation.mockResolvedValue(true)
    mocks.upgradeRunnerRun.mockResolvedValue(undefined)
  })

  it('aborts before running upgrades when repo is dirty and user declines', async () => {
    mocks.getGitWorkingTreeState.mockReturnValue({ isRepo: true, isDirty: true })
    mocks.promptForConfirmation.mockResolvedValue(false)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli({
      dir: '/repo',
      exclude: '',
      ignore: '',
      maxDepth: '10',
    })

    expect(mocks.promptForConfirmation).toHaveBeenCalledWith('Proceed anyway? [y/N] ', false)
    expect(mocks.upgradeRunnerRun).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('uncommitted changes detected'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('branch is not clean'))
  })

  it('continues when repo is dirty and user confirms', async () => {
    mocks.getGitWorkingTreeState.mockReturnValue({ isRepo: true, isDirty: true })
    mocks.promptForConfirmation.mockResolvedValue(true)

    await runCli({
      dir: '/repo',
      exclude: '',
      ignore: '',
      maxDepth: '10',
    })

    expect(mocks.promptForConfirmation).toHaveBeenCalledWith('Proceed anyway? [y/N] ', false)
    expect(mocks.upgradeRunnerRun).toHaveBeenCalledTimes(1)
  })

  it('skips the warning for a clean repo', async () => {
    mocks.getGitWorkingTreeState.mockReturnValue({ isRepo: true, isDirty: false })

    await runCli({
      dir: '/repo',
      exclude: '',
      ignore: '',
      maxDepth: '10',
    })

    expect(mocks.promptForConfirmation).not.toHaveBeenCalled()
    expect(mocks.upgradeRunnerRun).toHaveBeenCalledTimes(1)
  })

  it('skips the warning outside git', async () => {
    mocks.getGitWorkingTreeState.mockReturnValue({ isRepo: false, isDirty: false })

    await runCli({
      dir: '/repo',
      exclude: '',
      ignore: '',
      maxDepth: '10',
    })

    expect(mocks.promptForConfirmation).not.toHaveBeenCalled()
    expect(mocks.upgradeRunnerRun).toHaveBeenCalledTimes(1)
  })

  it('treats Ctrl+C at the prompt as cancel', async () => {
    mocks.getGitWorkingTreeState.mockReturnValue({ isRepo: true, isDirty: true })
    mocks.promptForConfirmation.mockResolvedValue(false)

    await runCli({
      dir: '/repo',
      exclude: '',
      ignore: '',
      maxDepth: '10',
    })

    expect(mocks.upgradeRunnerRun).not.toHaveBeenCalled()
  })
})
