import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderReadmeKeyTable } from '../../../src/ui/keymap'

const README_PATH = join(process.cwd(), 'README.md')
const START = '<!-- KEYS:START -->'
const END = '<!-- KEYS:END -->'

function readKeysRegion(readme: string): string {
  const start = readme.indexOf(START)
  const end = readme.indexOf(END)
  if (start === -1 || end === -1) {
    throw new Error('KEYS markers not found in README.md')
  }
  return readme.slice(start + START.length, end).replace(/\r\n/g, '\n').trim()
}

describe('readme keymap', () => {
  // Run `pnpm docs:keys` (sets UPDATE_README=1) to regenerate the README table;
  // a normal `pnpm test` only asserts it is in sync, so drift fails CI.
  it('README keyboard table stays in sync with the keymap', () => {
    const expected = renderReadmeKeyTable()

    if (process.env.UPDATE_README) {
      const readme = readFileSync(README_PATH, 'utf-8')
      const start = readme.indexOf(START)
      const end = readme.indexOf(END)
      if (start === -1 || end === -1) {
        throw new Error('KEYS markers not found in README.md')
      }
      const updated =
        readme.slice(0, start + START.length) + '\n' + expected + '\n' + readme.slice(end)
      writeFileSync(README_PATH, updated, 'utf-8')
    }

    expect(readKeysRegion(readFileSync(README_PATH, 'utf-8'))).toBe(expected)
  })
})
