import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  upgradeRunnerRun: vi.fn(),
  headlessRun: vi.fn(),
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

vi.mock('../../src/features/headless', () => ({
  HeadlessRunner: class {
    run = mocks.headlessRun
  },
}))

vi.mock('../../src/shared/config', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    loadProjectConfig: mocks.loadProjectConfig,
  }
})

vi.mock('../../src/shared/registry/version-checker', () => ({
  checkForUpdateAsync: mocks.checkForUpdateAsync,
}))

vi.mock('../../src/shared/git', () => ({
  getGitWorkingTreeState: mocks.getGitWorkingTreeState,
}))

vi.mock('../../src/shared/terminal/terminal-input', () => ({
  TerminalInput: {
    promptForImmediateConfirmation: mocks.promptForImmediateConfirmation,
  },
}))

import { runCli } from '../../src/cli'

// The dirty-tree preflight is an interactive-only concern; force a TTY (and clear $CI) so these
// tests exercise the interactive branch regardless of where the suite runs.
const originalIsTTY = process.stdout.isTTY
const originalCI = process.env.CI
const setInteractive = (interactive: boolean) =>
  Object.defineProperty(process.stdout, 'isTTY', { value: interactive, configurable: true })

describe('CLI git dirty preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setInteractive(true)
    delete process.env.CI

    mocks.loadProjectConfig.mockReturnValue({})
    mocks.checkForUpdateAsync.mockResolvedValue(null)
    mocks.getGitWorkingTreeState.mockReturnValue({ isRepo: false, isDirty: false })
    mocks.promptForImmediateConfirmation.mockResolvedValue(true)
    mocks.upgradeRunnerRun.mockResolvedValue(undefined)
    mocks.headlessRun.mockResolvedValue(undefined)
  })

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
    if (originalCI === undefined) delete process.env.CI
    else process.env.CI = originalCI
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

describe('CLI headless routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setInteractive(true)
    delete process.env.CI

    mocks.loadProjectConfig.mockReturnValue({})
    mocks.checkForUpdateAsync.mockResolvedValue(null)
    // A dirty repo to prove the preflight is skipped (would hang) on the headless path.
    mocks.getGitWorkingTreeState.mockReturnValue({ isRepo: true, isDirty: true })
    mocks.promptForImmediateConfirmation.mockResolvedValue(true)
    mocks.upgradeRunnerRun.mockResolvedValue(undefined)
    mocks.headlessRun.mockResolvedValue(undefined)
  })

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
    if (originalCI === undefined) delete process.env.CI
    else process.env.CI = originalCI
  })

  it('routes to runHeadless (and skips the TUI + dirty prompt) when not a TTY', async () => {
    setInteractive(false)

    await runCli({ dir: '/repo', exclude: '', ignore: '', maxDepth: '10' })

    expect(mocks.headlessRun).toHaveBeenCalledWith({
      json: undefined,
      check: undefined,
      apply: undefined,
      target: 'minor',
    })
    expect(mocks.upgradeRunnerRun).not.toHaveBeenCalled()
    expect(mocks.promptForImmediateConfirmation).not.toHaveBeenCalled()
  })

  it('routes to runHeadless when $CI is set even in a TTY', async () => {
    process.env.CI = '1'

    await runCli({ dir: '/repo', exclude: '', ignore: '', maxDepth: '10' })

    expect(mocks.headlessRun).toHaveBeenCalledTimes(1)
    expect(mocks.upgradeRunnerRun).not.toHaveBeenCalled()
  })

  it('routes to runHeadless with json/check flags even in a TTY', async () => {
    await runCli({ dir: '/repo', exclude: '', ignore: '', maxDepth: '10', json: true, check: true })

    expect(mocks.headlessRun).toHaveBeenCalledWith({
      json: true,
      check: true,
      apply: undefined,
      target: 'minor',
    })
    expect(mocks.upgradeRunnerRun).not.toHaveBeenCalled()
  })

  it('routes to runHeadless with apply/target even in a TTY', async () => {
    await runCli({
      dir: '/repo',
      exclude: '',
      ignore: '',
      maxDepth: '10',
      apply: true,
      target: 'latest',
    })

    expect(mocks.headlessRun).toHaveBeenCalledWith({
      json: undefined,
      check: undefined,
      apply: true,
      target: 'latest',
    })
    expect(mocks.upgradeRunnerRun).not.toHaveBeenCalled()
  })
})
