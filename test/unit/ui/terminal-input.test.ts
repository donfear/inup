import { describe, expect, it } from 'vitest'
import { TerminalInputInternals } from '../../../src/ui/utils/terminal-input'

describe('TerminalInput mouse filtering', () => {
  it('ignores SGR mouse sequences', () => {
    expect(
      TerminalInputInternals.isMouseSequence('\x1b[<64;61;18M', {
        sequence: '\x1b[<64;61;18M',
      })
    ).toBe(true)
  })

  it('ignores X10 mouse sequences', () => {
    expect(
      TerminalInputInternals.isMouseSequence('\x1b[M`!!', {
        sequence: '\x1b[M`!!',
      })
    ).toBe(true)
  })

  it('keeps keyboard arrow sequences', () => {
    expect(
      TerminalInputInternals.isMouseSequence('\x1b[B', {
        sequence: '\x1b[B',
        name: 'down',
      })
    ).toBe(false)
  })
})
