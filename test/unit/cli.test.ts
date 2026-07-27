import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  upgradeRunnerRun: vi.fn(),
  headlessRun: vi.fn(),
  loadProjectConfig: vi.fn(),
  checkForUpdateAsync: vi.fn(),
  getGitWorkingTreeState: vi.fn(),
  promptForImmediateConfirmation: vi.fn(),
  upgradeRunnerOptions: [] as unknown[],
}))

vi.mock('../../src/index', () => ({
  UpgradeRunner: class {
    constructor(options: unknown) {
      mocks.upgradeRunnerOptions.push(options)
    }
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

describe('CLI concurrency flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.upgradeRunnerOptions.length = 0
    setInteractive(true)
    delete process.env.CI

    mocks.loadProjectConfig.mockReturnValue({})
    mocks.checkForUpdateAsync.mockResolvedValue(null)
    mocks.getGitWorkingTreeState.mockReturnValue({ isRepo: false, isDirty: false })
    mocks.upgradeRunnerRun.mockResolvedValue(undefined)
    mocks.headlessRun.mockResolvedValue(undefined)
  })

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
    if (originalCI === undefined) delete process.env.CI
    else process.env.CI = originalCI
  })

  const baseOptions = { dir: '/repo', exclude: '', ignore: '', maxDepth: '10' }
  const runnerOptions = () => mocks.upgradeRunnerOptions[0] as { concurrency?: number }

  it('passes --concurrency through to the runner options', async () => {
    await runCli({ ...baseOptions, concurrency: '6' })
    expect(runnerOptions().concurrency).toBe(6)
  })

  it('leaves concurrency undefined when neither flag nor config sets it', async () => {
    await runCli(baseOptions)
    expect(runnerOptions().concurrency).toBeUndefined()
  })

  it('falls back to the .inuprc concurrency field', async () => {
    mocks.loadProjectConfig.mockReturnValue({ concurrency: 4 })
    await runCli(baseOptions)
    expect(runnerOptions().concurrency).toBe(4)
  })

  it('prefers the flag over the .inuprc field', async () => {
    mocks.loadProjectConfig.mockReturnValue({ concurrency: 4 })
    await runCli({ ...baseOptions, concurrency: '2' })
    expect(runnerOptions().concurrency).toBe(2)
  })

  it.each(['0', 'abc', '99', '7.5'])('rejects invalid --concurrency %s', async (raw) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit')
    }) as never)

    await expect(runCli({ ...baseOptions, concurrency: raw })).rejects.toThrow('process.exit')
    expect(exitSpy).toHaveBeenCalledWith(1)

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })
})

describe('CLI --init', () => {
  let testDir: string

  const initOptions = () => ({
    dir: testDir,
    exclude: '',
    ignore: '',
    maxDepth: '10',
    init: true,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    setInteractive(true)
    delete process.env.CI
    mocks.promptForImmediateConfirmation.mockResolvedValue(true)
    testDir = join(tmpdir(), `inup-cli-init-${process.pid}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
    if (originalCI === undefined) delete process.env.CI
    else process.env.CI = originalCI
  })

  it('creates .inuprc and runs neither the TUI nor the headless path', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(initOptions())

    const written = readFileSync(join(testDir, '.inuprc'), 'utf-8')
    expect(written).toContain('"ignore"')
    expect(mocks.promptForImmediateConfirmation).not.toHaveBeenCalled()
    expect(mocks.upgradeRunnerRun).not.toHaveBeenCalled()
    expect(mocks.headlessRun).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('asks before overwriting and keeps the file when declined', async () => {
    writeFileSync(join(testDir, '.inuprc'), '{"ignore": ["mine"]}')
    mocks.promptForImmediateConfirmation.mockResolvedValue(false)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(initOptions())

    expect(mocks.promptForImmediateConfirmation).toHaveBeenCalledWith(
      expect.stringContaining('Overwrite'),
      false
    )
    expect(readFileSync(join(testDir, '.inuprc'), 'utf-8')).toBe('{"ignore": ["mine"]}')
    logSpy.mockRestore()
  })

  it('overwrites when the user confirms', async () => {
    writeFileSync(join(testDir, '.inuprc'), '{"ignore": ["mine"]}')
    mocks.promptForImmediateConfirmation.mockResolvedValue(true)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(initOptions())

    expect(readFileSync(join(testDir, '.inuprc'), 'utf-8')).toContain('generated by inup')
    logSpy.mockRestore()
  })

  it('refuses to overwrite without a TTY instead of clobbering', async () => {
    writeFileSync(join(testDir, '.inuprc'), '{"ignore": ["mine"]}')
    setInteractive(false)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit')
    }) as never)

    await expect(runCli(initOptions())).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(readFileSync(join(testDir, '.inuprc'), 'utf-8')).toBe('{"ignore": ["mine"]}')
    expect(mocks.promptForImmediateConfirmation).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('writes .inuprc but warns when a different config filename exists', async () => {
    writeFileSync(join(testDir, 'inup.config.json'), '{"ignore": ["mine"]}')
    mocks.promptForImmediateConfirmation.mockResolvedValue(true)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCli(initOptions())

    expect(readFileSync(join(testDir, '.inuprc'), 'utf-8')).toContain('generated by inup')
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('takes precedence')
    logSpy.mockRestore()
  })
})
