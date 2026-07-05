import { describe, expect, it } from 'vitest'
import { detectJsonFormat } from '../../../../src/shared/fs/io'

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
})

describe('collectAllDependenciesAsync', () => {
  it('collects dependencies from every type and skips malformed files', async () => {
    const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { collectAllDependenciesAsync } = await import('../../../../src/shared/fs/io')

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
})
