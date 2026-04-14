import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { executeCommand } from '../../../src/utils/exec'
import { getGitWorkingTreeState } from '../../../src/utils/git'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inup-git-test-'))
}

describe('git utils', () => {
  it('returns clean state for a clean git repo', () => {
    const repoDir = createTempDir()

    executeCommand('git init', repoDir)
    executeCommand('git config user.email "test@example.com"', repoDir)
    executeCommand('git config user.name "Test User"', repoDir)
    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'hello\n')
    executeCommand('git add tracked.txt', repoDir)
    executeCommand('git commit -m "init"', repoDir)

    expect(getGitWorkingTreeState(repoDir)).toEqual({ isRepo: true, isDirty: false })
  })

  it('returns dirty state for tracked file modifications', () => {
    const repoDir = createTempDir()

    executeCommand('git init', repoDir)
    executeCommand('git config user.email "test@example.com"', repoDir)
    executeCommand('git config user.name "Test User"', repoDir)
    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'hello\n')
    executeCommand('git add tracked.txt', repoDir)
    executeCommand('git commit -m "init"', repoDir)
    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'changed\n')

    expect(getGitWorkingTreeState(repoDir)).toEqual({ isRepo: true, isDirty: true })
  })

  it('returns dirty state for untracked files', () => {
    const repoDir = createTempDir()

    executeCommand('git init', repoDir)
    executeCommand('git config user.email "test@example.com"', repoDir)
    executeCommand('git config user.name "Test User"', repoDir)
    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'hello\n')
    executeCommand('git add tracked.txt', repoDir)
    executeCommand('git commit -m "init"', repoDir)
    fs.writeFileSync(path.join(repoDir, 'untracked.txt'), 'new\n')

    expect(getGitWorkingTreeState(repoDir)).toEqual({ isRepo: true, isDirty: true })
  })

  it('returns non-repo state outside git without throwing', () => {
    const dir = createTempDir()

    expect(getGitWorkingTreeState(dir)).toEqual({ isRepo: false, isDirty: false })
  })
})
