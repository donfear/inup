import { describe, it, expect } from 'vitest'
import { detectJsonFormat } from '../../../src/utils/filesystem/io'

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
