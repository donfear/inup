import { readdirSync, statSync, realpathSync } from 'fs'
import { promises as fsPromises } from 'fs'
import { join, relative } from 'path'

export interface PackageJsonScanOptions {
  concurrency?: number
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

function shouldSkipDirectory(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRS.has(name)
}

export function findAllPackageJsonFiles(
  rootDir: string = process.cwd(),
  excludePatterns: string[] = [],
  maxDepth: number = 10,
  onProgress?: (current: string, found: number) => void
): string[] {
  const packageJsonFiles: string[] = []
  const visitedPaths = new Set<string>()
  let directoriesScanned = 0
  let lastProgressAt = 0
  const progressIntervalMs = 250

  const excludeRegexes = excludePatterns.map((pattern) => new RegExp(pattern, 'i'))

  function shouldExcludePath(relativePath: string): boolean {
    return excludeRegexes.some((regex) => regex.test(relativePath))
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

        let stat
        try {
          stat = statSync(fullPath)
        } catch {
          // Skip files/dirs we can't stat (broken symlinks, permission issues)
          continue
        }

        if (stat.isDirectory() && !shouldSkipDirectory(file)) {
          traverseDirectory(fullPath, depth + 1)
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

  const excludeRegexes = excludePatterns.map((pattern) => new RegExp(pattern, 'i'))

  function shouldExcludePath(relativePath: string): boolean {
    return excludeRegexes.some((regex) => regex.test(relativePath))
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

      let stat
      try {
        stat = await fsPromises.stat(fullPath)
      } catch {
        continue
      }

      if (stat.isDirectory() && !shouldSkipDirectory(file)) {
        schedule(fullPath, depth + 1)
      } else if (file === 'package.json' && stat.isFile()) {
        packageJsonFiles.push(fullPath)
      }
    }
  }

  function pump(): void {
    while (activeTasks < concurrency && pending.length > 0 && !failedError) {
      const next = pending.shift()
      if (!next) break

      activeTasks++
      void processDirectory(next.dir, next.depth)
        .catch((error) => {
          if (!failedError) {
            failedError = error
            rejectDone?.(error)
          }
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
