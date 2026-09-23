import type * as fs from 'node:fs'

/** Set `armed` to make the next writeFileSync behave like a full disk. */
export const diskFull = { armed: false }

/**
 * Wrap the real `node:fs` for `vi.mock` so an armed writeFileSync fails the way a disk that
 * fills up mid-write does: the first half of the data lands, then the call throws ENOSPC.
 * The flag disarms itself on use; unarmed, every call goes straight to the real function.
 *
 *   vi.mock('node:fs', async (importOriginal) => {
 *     const { withDiskFull } = await import('../helpers/disk-full')
 *     return withDiskFull(await importOriginal())
 *   })
 */
export function withDiskFull(actual: typeof fs): typeof fs {
  const writeFileSync: typeof fs.writeFileSync = (file, data, options) => {
    if (!diskFull.armed) return actual.writeFileSync(file, data, options)
    diskFull.armed = false
    const text = String(data)
    actual.writeFileSync(file, text.slice(0, text.length / 2), options)
    throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
  }
  return { ...actual, writeFileSync }
}
