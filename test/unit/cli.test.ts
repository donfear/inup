import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  upgradeRunnerRun: vi.fn(),
  loadProjectConfig: vi.fn(),
  checkForUpdateAsync: vi.fn(),
  getGitWorkingTreeState: vi.fn(),
  promptForImmediateConfirmation: vi.fn(),
}))

vi.mock('../../src/index', () => ({
  UpgradeRunner: class {
    run = mocks.upgradeRunnerRun
  },
}))

vi.mock('../../src/config', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    loadProjectConfig: mocks.loadProjectConfig,
  }
})

vi.mock('../../src/services', () => ({
  checkForUpdateAsync: mocks.checkForUpdateAsync,
}))

vi.mock('../../src/utils/git', () => ({
  getGitWorkingTreeState: mocks.getGitWorkingTreeState,
}))

vi.mock('../../src/ui/utils/terminal-input', () => ({
  TerminalInput: {
    promptForImmediateConfirmation: mocks.promptForImmediateConfirmation,
  },
}))

import { runCli } from '../../src/cli'

describe('CLI git dirty preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.loadProjectConfig.mockReturnValue({})
    mocks.checkForUpdateAsync.mockResolvedValue(null)
    mocks.getGitWorkingTreeState.mockReturnValue({ isRepo: false, isDirty: false })
    mocks.promptForImmediateConfirmation.mockResolvedValue(true)
    mocks.upgradeRunnerRun.mockResolvedValue(undefined)
  })

  it('aborts before running upgrades when repo is dirty and user declines', async () => {
    mocks.getGitWorkingTreeState.mockReturnValue({ isRepo: true, isDirty: true })
    mocks.promptForImmediateConfirmation.mockResolvedValue(false)

    await runCli({
      dir: '/repo',
      exclude: '',
      ignore: '',
      maxDepth: '10',
    })

    expect(mocks.promptForImmediateConfirmation).toHaveBeenCalledWith(
      expect.stringContaining('Warning: dirty working tree. Proceed anyway? [y/N] '),
      false
    )
    expect(mocks.upgradeRunnerRun).not.toHaveBeenCalled()
  })

  it('continues when repo is dirty and user confirms', async () => {
    mocks.getGitWorkingTreeState.mockReturnValue({ isRepo: true, isDirty: true })
    mocks.promptForImmediateConfirmation.mockResolvedValue(true)

    await runCli({
      dir: '/repo',
      exclude: '',
      ignore: '',
      maxDepth: '10',
    })

    expect(mocks.promptForImmediateConfirmation).toHaveBeenCalledWith(
      expect.stringContaining('Warning: dirty working tree. Proceed anyway? [y/N] '),
      false
    )
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

    expect(mocks.promptForImmediateConfirmation).not.toHaveBeenCalled()
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

    expect(mocks.promptForImmediateConfirmation).not.toHaveBeenCalled()
    expect(mocks.upgradeRunnerRun).toHaveBeenCalledTimes(1)
  })

  it('treats Ctrl+C at the prompt as cancel', async () => {
    mocks.getGitWorkingTreeState.mockReturnValue({ isRepo: true, isDirty: true })
    mocks.promptForImmediateConfirmation.mockResolvedValue(false)

    await runCli({
      dir: '/repo',
      exclude: '',
      ignore: '',
      maxDepth: '10',
    })

    expect(mocks.upgradeRunnerRun).not.toHaveBeenCalled()
  })
})
