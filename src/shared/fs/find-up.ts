import { dirname, resolve } from 'node:path'

/**
 * Walk from `start` up to the filesystem root, calling `match` on each directory
 * (nearest first, the root included). Returns the first non-undefined result, or
 * undefined when no directory matched. dirname(root) === root on every platform
 * ('/' on POSIX, 'C:\' on Windows), which is the single loop terminator.
 */
export function findUp<T>(start: string, match: (dir: string) => T | undefined): T | undefined {
  let dir = resolve(start)
  for (;;) {
    const found = match(dir)
    if (found !== undefined) return found
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}
