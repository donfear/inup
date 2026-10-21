import { execFile } from 'node:child_process'

export interface GitWorkingTreeState {
  isRepo: boolean
  isDirty: boolean
}

/**
 * Detect whether cwd is a git work tree and whether it has local changes.
 * Fail soft if git is unavailable or cwd is not a repository. Asynchronous, so
 * the project can be scanned while git looks at the tree.
 *
 * One `git status` answers both: it fails outside a work tree, including inside
 * a `.git` directory or a bare repository. Run without a shell.
 */
export function getGitWorkingTreeState(cwd: string): Promise<GitWorkingTreeState> {
  return new Promise((resolve) => {
    try {
      execFile('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' }, (error, status) =>
        resolve(
          error
            ? { isRepo: false, isDirty: false }
            : { isRepo: true, isDirty: status.trim().length > 0 }
        )
      )
    } catch {
      // Some spawn failures throw instead of reaching the callback, such as a cwd that is a file.
      resolve({ isRepo: false, isDirty: false })
    }
  })
}
