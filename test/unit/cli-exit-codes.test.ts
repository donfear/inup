import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exit codes set outside `runCli`: commander's own usage errors and the process-level
 * handlers the CLI module installs on import. Documented contract: 0 ok, 1 updates exist
 * (under --check), 2 error, 128 + signal when cancelled. Lives in its own file so the
 * handlers can be told apart from any a shared file had already registered.
 */
const events = ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'] as const
const before = new Map(events.map((event) => [event, process.listeners(event)]))

const { program } = await import('../../src/cli')

const handlerFor = (event: (typeof events)[number]) => {
  const added = process.listeners(event).filter((l) => !before.get(event)?.includes(l))
  expect(added).toHaveLength(1)
  return added[0] as (...args: unknown[]) => void
}

describe('CLI exit codes', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let out: string
  let err: string

  beforeEach(() => {
    out = ''
    err = ''
    program.configureOutput({
      writeOut: (text) => {
        out += text
      },
      writeErr: (text) => {
        err += text
      },
    })
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['an unknown option', ['--bogus']],
    ['an invalid --target choice', ['--target', 'foo']],
    ['an invalid --package-manager choice', ['--package-manager', 'nope']],
    ['a missing option value', ['--max-depth']],
  ])('exits 2 on %s, not 1 ("updates exist")', (_label, args) => {
    expect(() => program.parse(['--check', ...args], { from: 'user' })).toThrow('process.exit(2)')
    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(err).toMatch(/^error: /)
  })

  it.each([['--help'], ['--version']])('still exits 0 on %s', (flag) => {
    expect(() => program.parse([flag], { from: 'user' })).toThrow('process.exit(0)')
    expect(exitSpy).toHaveBeenCalledWith(0)
    expect(out).not.toBe('')
    expect(err).toBe('')
  })

  it.each([
    ['uncaughtException', new Error('boom')],
    ['unhandledRejection', new Error('boom')],
  ] as const)('exits 2 on an %s', (event, error) => {
    expect(() => handlerFor(event)(error)).toThrow('process.exit(2)')
    expect(errorSpy).toHaveBeenCalled()
  })

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('exits %s with %i and reports it on stderr, keeping stdout clean', (signal, code) => {
    // 128 + signal number, as a shell reports it, so `inup && git commit …` stops after a cancel.
    expect(() => handlerFor(signal)(signal)).toThrow(`process.exit(${code})`)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('cancelled'))
    expect(logSpy).not.toHaveBeenCalled()
  })
})
