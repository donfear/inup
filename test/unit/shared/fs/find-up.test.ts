import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, parse, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findUp } from '../../../../src/shared/fs/find-up'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'inup-find-up-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('findUp', () => {
  it('visits the start directory first, then each parent in order', () => {
    const nested = join(tempDir, 'a', 'b')
    mkdirSync(nested, { recursive: true })
    const visited: string[] = []

    findUp(nested, (dir) => {
      visited.push(dir)
      return dir === tempDir ? dir : undefined
    })

    expect(visited).toEqual([nested, dirname(nested), tempDir])
  })

  it('returns the first non-undefined result, including falsy values', () => {
    expect(findUp(tempDir, () => 0)).toBe(0)
    expect(findUp(tempDir, (dir) => (dir === tempDir ? null : 'parent'))).toBeNull()
  })

  it('checks the filesystem root and returns undefined when nothing matches', () => {
    const visited: string[] = []

    expect(
      findUp(tempDir, (dir) => {
        visited.push(dir)
        return undefined
      })
    ).toBeUndefined()
    expect(visited.at(-1)).toBe(parse(tempDir).root)
  })

  it('resolves a relative start against the working directory', () => {
    const visited: string[] = []
    findUp(relative(process.cwd(), tempDir) || '.', (dir) => {
      visited.push(dir)
      return dir
    })

    expect(visited).toEqual([tempDir])
  })
})
