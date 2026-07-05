import { existsSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadInupLocalEnv } from '../../../src/shared/local-env'

// findEnvFile walks up from the module's own directory, so real files cannot
// be planted without touching the repo — intercept the fs calls instead.
vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>()
  return {
    ...original,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
  }
})

const existsMock = vi.mocked(existsSync)
const readMock = vi.mocked(readFileSync)

const MANAGED_KEYS = ['T_FOO', 'T_QUOTED', 'T_SINGLE', 'T_EMPTY', 'T_EXISTING', 'T_SPACES']

beforeEach(() => {
  existsMock.mockReset()
  existsMock.mockReturnValue(false)
  readMock.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const key of MANAGED_KEYS) {
    delete process.env[key]
  }
})

describe('loadInupLocalEnv', () => {
  it('returns null when no .env.local exists within the walk limit', () => {
    expect(loadInupLocalEnv()).toBeNull()
    expect(existsMock.mock.calls.length).toBeLessThanOrEqual(12)
    expect(existsMock.mock.calls.every(([p]) => String(p).endsWith('.env.local'))).toBe(true)
  })

  it('parses the first .env.local found and applies it to process.env', () => {
    existsMock.mockReturnValueOnce(true)
    readMock.mockReturnValue(
      [
        '# a comment',
        '',
        'T_FOO=bar',
        'T_QUOTED="hello world"',
        "T_SINGLE='sq'",
        'T_EMPTY=',
        'no-equals-line',
        '=no-key',
        'T_SPACES =  padded  ',
      ].join('\n')
    )

    const loaded = loadInupLocalEnv()

    expect(loaded).toMatch(/\.env\.local$/)
    expect(process.env.T_FOO).toBe('bar')
    expect(process.env.T_QUOTED).toBe('hello world')
    expect(process.env.T_SINGLE).toBe('sq')
    expect(process.env.T_EMPTY).toBe('')
    expect(process.env.T_SPACES).toBe('padded')
    expect(process.env['no-equals-line']).toBeUndefined()
  })

  it('never overwrites existing environment values', () => {
    vi.stubEnv('T_EXISTING', 'from-shell')
    existsMock.mockReturnValueOnce(true)
    readMock.mockReturnValue('T_EXISTING=from-file\nT_FOO=bar')

    loadInupLocalEnv()

    expect(process.env.T_EXISTING).toBe('from-shell')
    expect(process.env.T_FOO).toBe('bar')
  })

  it('handles CRLF line endings', () => {
    existsMock.mockReturnValueOnce(true)
    readMock.mockReturnValue('T_FOO=bar\r\nT_SINGLE=baz\r\n')

    loadInupLocalEnv()

    expect(process.env.T_FOO).toBe('bar')
    expect(process.env.T_SINGLE).toBe('baz')
  })

  it('returns null when the file cannot be read', () => {
    existsMock.mockReturnValueOnce(true)
    readMock.mockImplementation(() => {
      throw new Error('EACCES')
    })

    expect(loadInupLocalEnv()).toBeNull()
  })
})
