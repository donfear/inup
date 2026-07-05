import { execSync } from 'node:child_process'

export interface GitWorkingTreeState {
  isRepo: boolean
  isDirty: boolean
}

/**
 * Detect whether cwd is a git work tree and whether it has local changes.
 * Fail soft if git is unavailable or cwd is not a repository.
 */
export function getGitWorkingTreeState(cwd: string): GitWorkingTreeState {
  try {
    const isInsideWorkTree = execSync('git rev-parse --is-inside-work-tree', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    if (isInsideWorkTree !== 'true') {
      return { isRepo: false, isDirty: false }
    }

    const status = execSync('git status --porcelain', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    return {
      isRepo: true,
      isDirty: status.trim().length > 0,
    }
  } catch {
    return { isRepo: false, isDirty: false }
  }
}
