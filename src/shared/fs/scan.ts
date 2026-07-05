import {
  existsSync,
  promises as fsPromises,
  readdirSync,
  realpathSync,
  type Stats,
  statSync,
} from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Normalize a relative path to forward slashes before matching `.inuprc` exclude patterns.
 * On Windows `path.relative` yields backslash separators (e.g. `packages\skipme`), but users write
 * exclude regexes with `/` (e.g. `^packages/skipme(?:/|$)`). Without this, excludes silently fail
 * on Windows and a path the user meant to skip gets scanned and upgraded.
 */
function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/')
}

export interface PackageJsonScanOptions {
  concurrency?: number
  /** Directory names that should be scanned even though they appear in the default skip list. */
  scanDirs?: string[]
  /**
   * Called with the repo-relative path of a directory that holds a package.json but was pruned
   * by the default skip list (not by the dot-prefix rule or user exclude patterns). Lets callers
   * warn that a package was silently skipped and can be re-included via `scanDirs`.
   */
  onSkippedPackageDir?: (relativePath: string) => void
}

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'out',
  'lib',
  'es',
  'esm',
  'cjs',
])

/**
 * Skip dirs that are ambiguous source-vs-build directories where a real package may legitimately
 * live. Only these trigger the "silently skipped a package" warning — node_modules and build-output
 * dirs (dist/build/coverage/out) routinely contain package.json files and would be pure noise.
 */
const WARN_SKIP_DIRS = new Set(['lib', 'es', 'esm', 'cjs'])

/** Effective skip set: the defaults minus any directory the caller opted back into via `scanDirs`. */
function buildSkipSet(scanDirs?: string[]): Set<string> {
  if (!scanDirs || scanDirs.length === 0) {
    return SKIP_DIRS
  }
  const skip = new Set(SKIP_DIRS)
  for (const dir of scanDirs) {
    skip.delete(dir)
  }
  return skip
}

type SkipReason = null | 'hidden' | 'skip-dir'

function classifyDirectory(name: string, skipSet: Set<string>): SkipReason {
  if (name.startsWith('.')) return 'hidden'
  if (skipSet.has(name)) return 'skip-dir'
  return null
}

/**
 * Cheaply decide whether a pruned directory looks like it holds a real package — a package.json
 * directly inside it, or inside any immediate child (the common `lib/<pkg>/package.json` monorepo
 * layout). Stays shallow (depth 1) so detecting a skip doesn't re-walk the subtree we just pruned.
 */
function prunedDirHoldsPackage(dir: string): boolean {
  if (existsSync(join(dir, 'package.json'))) {
    return true
  }
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return false
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const child = join(dir, entry)
    try {
      if (statSync(child).isDirectory() && existsSync(join(child, 'package.json'))) {
        return true
      }
    } catch {
      // Skip children we can't stat
    }
  }
  return false
}

/**
 * Decide whether to descend into a directory, and notify when one is pruned by the default skip
 * list despite containing a package.json (so the caller can surface a "silently skipped" warning).
 */
function shouldTraverse(
  name: string,
  fullPath: string,
  relativePath: string,
  skipSet: Set<string>,
  onSkippedPackageDir?: (relativePath: string) => void
): boolean {
  const reason = classifyDirectory(name, skipSet)
  if (reason === null) {
    return true
  }
  if (
    reason === 'skip-dir' &&
    WARN_SKIP_DIRS.has(name) &&
    onSkippedPackageDir &&
    prunedDirHoldsPackage(fullPath)
  ) {
    onSkippedPackageDir(relativePath)
  }
  return false
}

export function findAllPackageJsonFiles(
  rootDir: string = process.cwd(),
  excludePatterns: string[] = [],
  maxDepth: number = 10,
  onProgress?: (current: string, found: number) => void,
  options: PackageJsonScanOptions = {}
): string[] {
  const packageJsonFiles: string[] = []
  const visitedPaths = new Set<string>()
  let directoriesScanned = 0
  let lastProgressAt = 0
  const progressIntervalMs = 250
  const skipSet = buildSkipSet(options.scanDirs)

  const excludeRegexes = excludePatterns.map((pattern) => new RegExp(pattern, 'i'))

  function shouldExcludePath(relativePath: string): boolean {
    const posix = toPosixPath(relativePath)
    return excludeRegexes.some((regex) => regex.test(posix))
  }

  function reportProgress(currentDir: string, force: boolean = false): void {
    if (!onProgress) return

    const now = Date.now()
    if (!force && now - lastProgressAt < progressIntervalMs) {
      return
    }

    lastProgressAt = now
    const relativePath = relative(rootDir, currentDir) || '.'
    onProgress(relativePath, packageJsonFiles.length)
  }

  function traverseDirectory(dir: string, depth: number = 0): void {
    if (depth > maxDepth) {
      return
    }

    try {
      // Prevent symlink cycles by tracking visited real paths
      const realPath = realpathSync(dir)
      if (visitedPaths.has(realPath)) {
        return
      }
      visitedPaths.add(realPath)

      directoriesScanned++

      // Report progress every 10 directories or on first scan
      if (onProgress && (directoriesScanned % 10 === 0 || directoriesScanned === 1)) {
        reportProgress(dir, true)
      }

      const files = readdirSync(dir)

      for (const file of files) {
        reportProgress(dir)
        const fullPath = join(dir, file)
        const relativePath = relative(rootDir, fullPath)

        if (shouldExcludePath(relativePath)) {
          continue
        }

        let stat: Stats
        try {
          stat = statSync(fullPath)
        } catch {
          // Skip files/dirs we can't stat (broken symlinks, permission issues)
          continue
        }

        if (stat.isDirectory()) {
          if (shouldTraverse(file, fullPath, relativePath, skipSet, options.onSkippedPackageDir)) {
            traverseDirectory(fullPath, depth + 1)
          }
        } else if (file === 'package.json' && stat.isFile()) {
          packageJsonFiles.push(fullPath)
        }
      }
    } catch {
      // Skip directories that can't be read (permission issues, etc.)
    }
  }

  traverseDirectory(rootDir)
  return packageJsonFiles
}

export async function findAllPackageJsonFilesAsync(
  rootDir: string = process.cwd(),
  excludePatterns: string[] = [],
  maxDepth: number = 10,
  onProgress?: (current: string, found: number) => void,
  options: PackageJsonScanOptions = {}
): Promise<string[]> {
  const packageJsonFiles: string[] = []
  const visitedPaths = new Set<string>()
  let directoriesScanned = 0
  let lastProgressAt = 0
  const progressIntervalMs = 250
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 16, 64))
  const skipSet = buildSkipSet(options.scanDirs)

  const excludeRegexes = excludePatterns.map((pattern) => new RegExp(pattern, 'i'))

  function shouldExcludePath(relativePath: string): boolean {
    const posix = toPosixPath(relativePath)
    return excludeRegexes.some((regex) => regex.test(posix))
  }

  function reportProgress(currentDir: string, force: boolean = false): void {
    if (!onProgress) return

    const now = Date.now()
    if (!force && now - lastProgressAt < progressIntervalMs) {
      return
    }

    lastProgressAt = now
    const relativePath = relative(rootDir, currentDir) || '.'
    onProgress(relativePath, packageJsonFiles.length)
  }

  const pending: Array<{ dir: string; depth: number }> = []
  let activeTasks = 0
  let failedError: unknown = null
  let resolveDone: (() => void) | null = null
  let rejectDone: ((error: unknown) => void) | null = null

  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })

  function finishIfIdle(): void {
    if (pending.length === 0 && activeTasks === 0) {
      resolveDone?.()
    }
  }

  function schedule(dir: string, depth: number): void {
    pending.push({ dir, depth })
    pump()
  }

  async function processDirectory(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return
    }

    let realPath: string
    try {
      realPath = await fsPromises.realpath(dir)
    } catch {
      return
    }

    if (visitedPaths.has(realPath)) {
      return
    }
    visitedPaths.add(realPath)

    directoriesScanned++
    if (directoriesScanned % 10 === 0 || directoriesScanned === 1) {
      reportProgress(dir, true)
    }

    let files: string[]
    try {
      files = await fsPromises.readdir(dir)
    } catch {
      return
    }

    for (const file of files) {
      reportProgress(dir)

      const fullPath = join(dir, file)
      const relativePath = relative(rootDir, fullPath)

      if (shouldExcludePath(relativePath)) {
        continue
      }

      let stat: Stats
      try {
        stat = await fsPromises.stat(fullPath)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        if (shouldTraverse(file, fullPath, relativePath, skipSet, options.onSkippedPackageDir)) {
          schedule(fullPath, depth + 1)
        }
      } else if (file === 'package.json' && stat.isFile()) {
        packageJsonFiles.push(fullPath)
      }
    }
  }

  function pump(): void {
    while (activeTasks < concurrency && !failedError) {
      const next = pending.shift()
      if (!next) break

      activeTasks++
      void processDirectory(next.dir, next.depth)
        .catch((error) => {
          // First error wins; a second in-flight task rejecting in the same
          // tick is a race window that cannot be scheduled deterministically.
          /* v8 ignore start */
          if (!failedError) {
            failedError = error
            rejectDone?.(error)
          }
          /* v8 ignore stop */
        })
        .finally(() => {
          activeTasks--
          if (failedError) {
            return
          }
          pump()
          finishIfIdle()
        })
    }
  }

  schedule(rootDir, 0)
  await done

  return packageJsonFiles
}
