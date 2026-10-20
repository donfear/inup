import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { executeCommand } from '../../../src/shared/exec'
import { getGitWorkingTreeState } from '../../../src/shared/git'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inup-git-test-'))
}

describe('git utils', () => {
  it('returns clean state for a clean git repo', async () => {
    const repoDir = createTempDir()

    executeCommand('git init', repoDir)
    executeCommand('git config user.email "test@example.com"', repoDir)
    executeCommand('git config user.name "Test User"', repoDir)
    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'hello\n')
    executeCommand('git add tracked.txt', repoDir)
    executeCommand('git commit -m "init"', repoDir)

    expect(await getGitWorkingTreeState(repoDir)).toEqual({ isRepo: true, isDirty: false })
  })

  it('returns dirty state for tracked file modifications', async () => {
    const repoDir = createTempDir()

    executeCommand('git init', repoDir)
    executeCommand('git config user.email "test@example.com"', repoDir)
    executeCommand('git config user.name "Test User"', repoDir)
    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'hello\n')
    executeCommand('git add tracked.txt', repoDir)
    executeCommand('git commit -m "init"', repoDir)
    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'changed\n')

    expect(await getGitWorkingTreeState(repoDir)).toEqual({ isRepo: true, isDirty: true })
  })

  it('returns dirty state for untracked files', async () => {
    const repoDir = createTempDir()

    executeCommand('git init', repoDir)
    executeCommand('git config user.email "test@example.com"', repoDir)
    executeCommand('git config user.name "Test User"', repoDir)
    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'hello\n')
    executeCommand('git add tracked.txt', repoDir)
    executeCommand('git commit -m "init"', repoDir)
    fs.writeFileSync(path.join(repoDir, 'untracked.txt'), 'new\n')

    expect(await getGitWorkingTreeState(repoDir)).toEqual({ isRepo: true, isDirty: true })
  })

  it('returns non-repo state outside git without throwing', async () => {
    const dir = createTempDir()

    expect(await getGitWorkingTreeState(dir)).toEqual({ isRepo: false, isDirty: false })
  })

  it('works in a repo path containing spaces (cwd is an option, not shell-interpolated)', async () => {
    const repoDir = path.join(createTempDir(), 'my project dir')
    fs.mkdirSync(repoDir)

    executeCommand('git init', repoDir)
    executeCommand('git config user.email "test@example.com"', repoDir)
    executeCommand('git config user.name "Test User"', repoDir)
    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'hello\n')
    executeCommand('git add tracked.txt', repoDir)
    executeCommand('git commit -m "init"', repoDir)

    expect(await getGitWorkingTreeState(repoDir)).toEqual({ isRepo: true, isDirty: false })

    fs.writeFileSync(path.join(repoDir, 'untracked.txt'), 'new\n')
    expect(await getGitWorkingTreeState(repoDir)).toEqual({ isRepo: true, isDirty: true })
  })
})

it('reports non-worktree git contexts as not a repo', async () => {
  const repoDir = createTempDir()

  const bareDir = createTempDir()

  executeCommand('git init', repoDir)
  executeCommand('git init --bare', bareDir)
  expect(await getGitWorkingTreeState(bareDir)).toEqual({ isRepo: false, isDirty: false })

  // Inside the .git directory itself, git status refuses to run.
  expect(await getGitWorkingTreeState(path.join(repoDir, '.git'))).toEqual({
    isRepo: false,
    isDirty: false,
  })
})

it('fails soft when git cannot read the tree it is inside', async () => {
  const repoDir = createTempDir()

  executeCommand('git init', repoDir)
  // git status refuses a corrupt index.
  fs.writeFileSync(path.join(repoDir, '.git', 'index'), 'not an index')

  expect(await getGitWorkingTreeState(repoDir)).toEqual({ isRepo: false, isDirty: false })
})
