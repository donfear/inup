import {
  type Dirent,
  existsSync,
  promises as fsPromises,
  readdirSync,
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
 * `__fixtures__`, `__mocks__`, `__tests__`, `__snapshots__`, `__generated__`: the dunder prefix is a
 * tooling convention for directories that hold test data and generated code, the same way a dot
 * prefix marks a tool's own directory. Manifests under them name packages that are not on the
 * registry, so scanning them costs a wasted request and offers an upgrade nobody wants.
 */
const TOOLING_DIR_PREFIX = '__'

/**
 * Skip dirs that are ambiguous source-vs-build directories where a real package may legitimately
 * live. Only these trigger the "silently skipped a package" warning — node_modules and build-output
 * dirs (dist/build/coverage/out) routinely contain package.json files and would be pure noise.
 */
const WARN_SKIP_DIRS = new Set(['lib', 'es', 'esm', 'cjs'])

/** Names the caller opted back into via `scanDirs`, which outrank every default skip rule. */
function buildScanSet(scanDirs?: string[]): Set<string> {
  return new Set(scanDirs ?? [])
}

type SkipReason = null | 'hidden' | 'skip-dir'

function classifyDirectory(name: string, scanSet: Set<string>): SkipReason {
  if (scanSet.has(name)) return null
  if (name.startsWith('.')) return 'hidden'
  if (SKIP_DIRS.has(name) || name.startsWith(TOOLING_DIR_PREFIX)) return 'skip-dir'
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
  scanSet: Set<string>,
  onSkippedPackageDir?: (relativePath: string) => void
): boolean {
  const reason = classifyDirectory(name, scanSet)
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
  const scanSet = buildScanSet(options.scanDirs)

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

    let entries: Dirent[]
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      reportProgress(dir)

      const file = entry.name
      const fullPath = join(dir, file)
      const relativePath = relative(rootDir, fullPath)

      if (shouldExcludePath(relativePath)) {
        continue
      }

      let target: Dirent | Stats
      try {
        target = entry.isSymbolicLink() ? await fsPromises.stat(fullPath) : entry
      } catch {
        continue
      }

      if (target.isDirectory()) {
        if (shouldTraverse(file, fullPath, relativePath, scanSet, options.onSkippedPackageDir)) {
          schedule(fullPath, depth + 1)
        }
      } else if (file === 'package.json' && target.isFile()) {
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
