import { getCompileCacheDir } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Startup cost: `inup --json` / `--check` must not load the interactive runner
 * graph (renderer, themes, changelog, wrap-ansi, …), and the CLI enables Node's
 * compile cache. Lives in its own file so the mock factory's first run is the
 * signal that the module was imported — a shared file would have loaded it
 * already.
 */
const mocks = vi.hoisted(() => ({
  indexModuleLoads: 0,
  headlessModuleLoads: 0,
  upgradeRunnerRun: vi.fn(),
  headlessRun: vi.fn(),
}))

vi.mock('../../src/index', () => {
  mocks.indexModuleLoads++
  return {
    UpgradeRunner: class {
      run = mocks.upgradeRunnerRun
    },
  }
})

vi.mock('../../src/features/headless', () => {
  mocks.headlessModuleLoads++
  return {
    HeadlessRunner: class {
      run = mocks.headlessRun
    },
  }
})

vi.mock('../../src/shared/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/config')>()),
  loadProjectConfig: () => ({}),
}))

vi.mock('../../src/shared/registry/version-checker', () => ({
  checkForUpdateAsync: async () => null,
}))

vi.mock('../../src/shared/git', () => ({
  getGitWorkingTreeState: () => ({ isRepo: false, isDirty: false }),
}))

import { runCli } from '../../src/cli'

const originalIsTTY = process.stdout.isTTY
const originalCI = process.env.CI
const setInteractive = (interactive: boolean) =>
  Object.defineProperty(process.stdout, 'isTTY', { value: interactive, configurable: true })

describe('CLI startup', () => {
  beforeEach(() => {
    mocks.upgradeRunnerRun.mockReset()
    mocks.headlessRun.mockReset()
    delete process.env.CI
    mocks.upgradeRunnerRun.mockResolvedValue(undefined)
    mocks.headlessRun.mockResolvedValue(undefined)
  })

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
    if (originalCI === undefined) delete process.env.CI
    else process.env.CI = originalCI
  })

  it('imports neither runner until a mode is chosen', () => {
    expect(mocks.indexModuleLoads).toBe(0)
    expect(mocks.headlessModuleLoads).toBe(0)
  })

  it('loads only the headless runner on the headless path', async () => {
    setInteractive(false)

    await runCli({ dir: '/repo', exclude: '', ignore: '', maxDepth: '10', json: true })

    expect(mocks.headlessRun).toHaveBeenCalledTimes(1)
    expect(mocks.headlessModuleLoads).toBe(1)
    expect(mocks.indexModuleLoads).toBe(0)
  })

  it('loads the interactive runner only on the interactive path', async () => {
    setInteractive(true)

    await runCli({ dir: '/repo', exclude: '', ignore: '', maxDepth: '10' })

    expect(mocks.upgradeRunnerRun).toHaveBeenCalledTimes(1)
    expect(mocks.indexModuleLoads).toBe(1)
  })

  it('enables the V8 compile cache when the CLI module loads', () => {
    // Each test file runs in a fresh worker where the cache starts disabled
    // (getCompileCacheDir() is undefined); importing the CLI above enabled it.
    expect(getCompileCacheDir()).toMatch(/node-compile-cache/)
  })
})
