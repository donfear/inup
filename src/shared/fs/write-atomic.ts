import {
  accessSync,
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'

/**
 * Replace a file's contents so it is never left half-written. writeFileSync truncates
 * first, so a full disk, a crash or a kill mid-write leaves the user's package.json
 * empty or cut off. Instead, write a temp file beside it, flush it, and rename it over
 * the original: readers see either the old file or the new one, nothing in between.
 *
 * The temp file sits in the same directory because rename is only atomic within one
 * filesystem. The original's permission bits carry over, and a symlinked file is
 * updated at its real location rather than having the link replaced by a plain file.
 * A read-only file is refused, just as an in-place write would refuse it.
 */
export function writeFileAtomic(path: string, content: string): void {
  const existing = statSync(path, { throwIfNoEntry: false })
  const target = existing ? realpathSync(path) : path
  // rename only needs a writable directory, so it would quietly replace a file the user
  // made read-only. Fail with the same EACCES/EPERM the in-place write gave instead.
  if (existing) accessSync(target, constants.W_OK)
  const temp = `${target}.${process.pid}.tmp`
  try {
    const fd = openSync(temp, 'w')
    try {
      // fchmod rather than openSync's mode argument, which the umask would filter.
      if (existing) fchmodSync(fd, existing.mode & 0o7777)
      writeFileSync(fd, content)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temp, target)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}
