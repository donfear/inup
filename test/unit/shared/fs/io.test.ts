import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debugLog } from '../../../../src/shared/debug-logger'
import {
  collectAllDependenciesAsync,
  detectJsonFormat,
  readPackageJson,
  readPackageJsonAsync,
  stringifyWithFormat,
  stripBom,
} from '../../../../src/shared/fs/io'

describe('detectJsonFormat', () => {
  it('detects 2-space indentation', () => {
    const raw = '{\n  "name": "x",\n  "version": "1.0.0"\n}\n'
    expect(detectJsonFormat(raw).indent).toBe('  ')
  })

  it('detects 4-space indentation', () => {
    const raw = '{\n    "name": "x"\n}\n'
    expect(detectJsonFormat(raw).indent).toBe('    ')
  })

  it('detects tab indentation', () => {
    const raw = '{\n\t"name": "x"\n}\n'
    expect(detectJsonFormat(raw).indent).toBe('\t')
  })

  it('preserves a trailing newline when present', () => {
    expect(detectJsonFormat('{\n  "a": 1\n}\n').trailingNewline).toBe(true)
  })

  it('reports no trailing newline when absent', () => {
    expect(detectJsonFormat('{\n  "a": 1\n}').trailingNewline).toBe(false)
  })

  it('falls back to 2-space for minified/single-line JSON', () => {
    const result = detectJsonFormat('{"a":1}')
    expect(result.indent).toBe(2)
    expect(result.trailingNewline).toBe(false)
  })

  it('falls back to 2-space but still detects a trailing newline on single-line JSON', () => {
    const result = detectJsonFormat('{"a":1}\n')
    expect(result.indent).toBe(2)
    expect(result.trailingNewline).toBe(true)
  })

  it('reports LF line endings for a plain LF document', () => {
    expect(detectJsonFormat('{\n  "a": 1\n}\n').newline).toBe('\n')
  })

  it('detects CRLF line endings (Windows-authored files)', () => {
    const result = detectJsonFormat('{\r\n  "a": 1\r\n}\r\n')
    expect(result.newline).toBe('\r\n')
    expect(result.indent).toBe('  ')
    expect(result.trailingNewline).toBe(true)
  })

  it('detects tab indentation through CRLF line endings', () => {
    expect(detectJsonFormat('{\r\n\t"a": 1\r\n}\r\n').indent).toBe('\t')
  })

  it('detects a missing trailing newline on a CRLF document', () => {
    const result = detectJsonFormat('{\r\n  "a": 1\r\n}')
    expect(result.newline).toBe('\r\n')
    expect(result.trailingNewline).toBe(false)
  })

  it('detects a leading UTF-8 byte order mark (Windows editors add one)', () => {
    expect(detectJsonFormat('\uFEFF{\n  "a": 1\n}\n').bom).toBe(true)
    expect(detectJsonFormat('{\n  "a": 1\n}\n').bom).toBe(false)
  })
})

describe('stringifyWithFormat', () => {
  it('round-trips an unchanged LF document byte-for-byte', () => {
    const raw = '{\n  "a": 1\n}\n'
    expect(stringifyWithFormat(JSON.parse(raw), detectJsonFormat(raw))).toBe(raw)
  })

  it('round-trips an unchanged CRLF document byte-for-byte', () => {
    const raw = '{\r\n  "a": 1,\r\n  "b": {\r\n    "c": 2\r\n  }\r\n}\r\n'
    expect(stringifyWithFormat(JSON.parse(raw), detectJsonFormat(raw))).toBe(raw)
  })

  it('round-trips CRLF with tab indentation and no trailing newline', () => {
    const raw = '{\r\n\t"a": 1\r\n}'
    expect(stringifyWithFormat(JSON.parse(raw), detectJsonFormat(raw))).toBe(raw)
  })

  it('emits CRLF for every line, including the trailing newline', () => {
    const out = stringifyWithFormat({ a: 1, b: 2 }, detectJsonFormat('{\r\n  "x": 0\r\n}\r\n'))
    expect(out.split('\r\n').length).toBe(out.split('\n').length)
    expect(out.endsWith('\r\n')).toBe(true)
  })

  it('never introduces carriage returns into an LF document', () => {
    const out = stringifyWithFormat({ a: 1 }, detectJsonFormat('{\n  "x": 0\n}\n'))
    expect(out.includes('\r')).toBe(false)
  })

  it('round-trips an unchanged BOM + CRLF document byte-for-byte', () => {
    const raw = '\uFEFF{\r\n  "a": 1\r\n}\r\n'
    expect(stringifyWithFormat(JSON.parse(stripBom(raw)), detectJsonFormat(raw))).toBe(raw)
  })

  it('never introduces a byte order mark into a document that had none', () => {
    const out = stringifyWithFormat({ a: 1 }, detectJsonFormat('{\n  "x": 0\n}\n'))
    expect(out.startsWith('{')).toBe(true)
  })
})

describe('reading a package.json with a UTF-8 byte order mark', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'inup-io-bom-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const writeBomManifest = () => {
    const path = join(tempDir, 'package.json')
    writeFileSync(path, `\uFEFF${JSON.stringify({ name: 'bom', packageManager: 'pnpm@10.0.0' })}`)
    return path
  }

  it('parses it synchronously', () => {
    expect(readPackageJson(writeBomManifest())).toMatchObject({ name: 'bom' })
  })

  it('parses it asynchronously', async () => {
    await expect(readPackageJsonAsync(writeBomManifest())).resolves.toMatchObject({ name: 'bom' })
  })

  it('still rejects a manifest that is malformed after the mark', () => {
    const path = join(tempDir, 'package.json')
    writeFileSync(path, '\uFEFF{malformed')
    expect(() => readPackageJson(path)).toThrow('Failed to read package.json')
  })
})

describe('collectAllDependenciesAsync', () => {
  it('collects dependencies from every type and skips malformed files', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'inup-io-test-'))
    try {
      const good = join(tempDir, 'good')
      const bad = join(tempDir, 'bad')
      mkdirSync(good)
      mkdirSync(bad)
      writeFileSync(
        join(good, 'package.json'),
        JSON.stringify({
          dependencies: { alpha: '^1.0.0' },
          devDependencies: { beta: '~2.0.0' },
          peerDependencies: { gamma: '>=3' },
          optionalDependencies: { delta: '4.0.0' },
        })
      )
      writeFileSync(join(bad, 'package.json'), '{malformed')

      const deps = await collectAllDependenciesAsync([
        join(good, 'package.json'),
        join(bad, 'package.json'),
      ])

      expect(deps.map((d) => d.name).sort()).toEqual(['alpha', 'beta', 'delta', 'gamma'])
      expect(deps.find((d) => d.name === 'gamma')?.type).toBe('peerDependencies')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('skips dependency values that are not strings instead of crashing the scan', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'inup-io-test-'))
    const warnSpy = vi.spyOn(debugLog, 'warn').mockImplementation(() => {})
    try {
      const path = join(tempDir, 'package.json')
      writeFileSync(
        path,
        JSON.stringify({
          dependencies: { foo: null, alpha: '^1.0.0' },
          devDependencies: { bar: 1, baz: { version: '1.0.0' } },
        })
      )

      const deps = await collectAllDependenciesAsync([path])

      expect(deps.map((d) => d.name)).toEqual(['alpha'])
      expect(warnSpy).toHaveBeenCalledTimes(3)
      expect(warnSpy).toHaveBeenCalledWith(
        'DependencyCollector',
        expect.stringContaining(`skipping dependencies.foo in ${path}`)
      )
    } finally {
      warnSpy.mockRestore()
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('collects dependencies from a manifest saved with a byte order mark', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'inup-io-test-'))
    try {
      const path = join(tempDir, 'package.json')
      writeFileSync(path, `\uFEFF${JSON.stringify({ dependencies: { alpha: '^1.0.0' } })}`)

      const deps = await collectAllDependenciesAsync([path])

      expect(deps).toEqual([
        { name: 'alpha', version: '^1.0.0', type: 'dependencies', packageJsonPath: path },
      ])
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('collects the name of every manifest that has one into localNames', async () => {
    const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { collectAllDependenciesAsync } = await import('../../../../src/shared/fs/io')

    const tempDir = mkdtempSync(join(tmpdir(), 'inup-io-test-'))
    try {
      const manifest = (dir: string, value: unknown) => {
        mkdirSync(join(tempDir, dir))
        writeFileSync(join(tempDir, dir, 'package.json'), JSON.stringify(value))
        return join(tempDir, dir, 'package.json')
      }
      const files = [
        manifest('utils', { name: '@org/utils', version: '1.0.0' }),
        manifest('unnamed', { dependencies: { alpha: '^1.0.0' } }),
      ]
      const localNames = new Set<string>()

      await collectAllDependenciesAsync(files, localNames)

      expect([...localNames]).toEqual(['@org/utils'])
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
