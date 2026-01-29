import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from 'fs'
import { promises as fsPromises } from 'fs'
import { join, relative } from 'path'
import { PackageJson, PackageManager } from '../types'
import { PackageManagerDetector } from '../services/package-manager-detector'

/**
 * Find package.json in the current working directory
 */
export function findPackageJson(cwd: string = process.cwd()): string | null {
  const packageJsonPath = join(cwd, 'package.json')
  return existsSync(packageJsonPath) ? packageJsonPath : null
}

/**
 * Find the workspace root by detecting package manager and checking for workspace configuration
 * @param cwd - Current working directory
 * @param packageManager - Optional package manager to use (will auto-detect if not provided)
 */
export function findWorkspaceRoot(
  cwd: string = process.cwd(),
  packageManager?: PackageManager
): string | null {
  // Auto-detect if not provided
  if (!packageManager) {
    const detected = PackageManagerDetector.detect(cwd)
    packageManager = detected.name
  }

  return PackageManagerDetector.findWorkspaceRoot(cwd, packageManager)
}

/**
 * Read and parse a package.json file
 */
export function readPackageJson(path: string): PackageJson {
  try {
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    throw new Error(`Failed to read package.json: ${error}`)
  }
}

/**
 * Read and parse a package.json file asynchronously
 */
export async function readPackageJsonAsync(path: string): Promise<PackageJson> {
  try {
    const content = await fsPromises.readFile(path, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    throw new Error(`Failed to read package.json: ${error}`)
  }
}

export interface CollectDependenciesOptions {
  includePeerDeps?: boolean
  includeOptionalDeps?: boolean
}

/**
 * Collects all dependencies from multiple package.json files.
 * Always includes regular dependencies and devDependencies.
 * Optionally includes peer and optional dependencies based on flags.
 */
export function collectAllDependencies(
  packageJsonFiles: string[],
  options: CollectDependenciesOptions = {}
): Array<{ name: string; version: string; type: string; packageJsonPath: string }> {
  const allDeps: Array<{ name: string; version: string; type: string; packageJsonPath: string }> =
    []

  for (const packageJsonPath of packageJsonFiles) {
    try {
      const packageJson = readPackageJson(packageJsonPath)
      const depTypes: Array<
        'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies'
      > = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

      for (const depType of depTypes) {
        const deps = packageJson[depType]
        if (deps && typeof deps === 'object') {
          for (const [name, version] of Object.entries(deps)) {
            allDeps.push({
              name,
              version: version as string,
              type: depType,
              packageJsonPath,
            })
          }
        }
      }
    } catch (error) {
      // Skip malformed package.json files
    }
  }

  return allDeps
}

/**
 * Collects all dependencies from multiple package.json files asynchronously.
 * Reads all package.json files in parallel for better performance.
 * Always includes regular dependencies and devDependencies.
 * Optionally includes peer and optional dependencies based on flags.
 */
export async function collectAllDependenciesAsync(
  packageJsonFiles: string[],
  options: CollectDependenciesOptions = {}
): Promise<Array<{ name: string; version: string; type: string; packageJsonPath: string }>> {
  // Read all package.json files in parallel
  const packageJsonPromises = packageJsonFiles.map(async (packageJsonPath) => {
    try {
      const packageJson = await readPackageJsonAsync(packageJsonPath)
      return { packageJson, packageJsonPath }
    } catch (error) {
      // Skip malformed package.json files
      return null
    }
  })

  const results = await Promise.all(packageJsonPromises)

  // Collect dependencies from all successfully read package.json files
  const allDeps: Array<{ name: string; version: string; type: string; packageJsonPath: string }> =
    []

  for (const result of results) {
    if (!result) continue

    const { packageJson, packageJsonPath } = result
    const depTypes: Array<
      'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies'
    > = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

    for (const depType of depTypes) {
      const deps = packageJson[depType]
      if (deps && typeof deps === 'object') {
        for (const [name, version] of Object.entries(deps)) {
          allDeps.push({
            name,
            version: version as string,
            type: depType,
            packageJsonPath,
          })
        }
      }
    }
  }

  return allDeps
}

/**
 * Find all package.json files recursively
 */
export function findAllPackageJsonFiles(
  rootDir: string = process.cwd(),
  excludePatterns: string[] = [],
  maxDepth: number = 10,
  onProgress?: (current: string, found: number) => void
): string[] {
  const packageJsonFiles: string[] = []
  const visitedPaths = new Set<string>()
  let directoriesScanned = 0

  // Compile regex patterns for exclude filtering
  const excludeRegexes = excludePatterns.map((pattern) => new RegExp(pattern, 'i'))

  function shouldExcludePath(relativePath: string): boolean {
    return excludeRegexes.some((regex) => regex.test(relativePath))
  }

  function traverseDirectory(dir: string, depth: number = 0): void {
    // Prevent infinite recursion with depth limit
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
        const relativePath = relative(rootDir, dir) || '.'
        onProgress(relativePath, packageJsonFiles.length)
      }

      const files = readdirSync(dir)

      for (const file of files) {
        const fullPath = join(dir, file)
        const relativePath = relative(rootDir, fullPath)

        // Skip if path matches exclude patterns
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

        // Skip common build and dependency directories
        const skipDirs = [
          'node_modules',
          '.git',
          'dist',
          'build',
          '.next',
          'coverage',
          '.cache',
          'out',
          '.output',
          '.nuxt',
          '.vercel',
          '.netlify',
          'lib',
          'es',
          'esm',
          'cjs',
        ]
        if (stat.isDirectory() && !file.startsWith('.') && !skipDirs.includes(file)) {
          traverseDirectory(fullPath, depth + 1)
        } else if (file === 'package.json' && stat.isFile()) {
          packageJsonFiles.push(fullPath)
        }
      }
    } catch (error) {
      // Skip directories that can't be read (permission issues, etc.)
    }
  }

  traverseDirectory(rootDir)
  return packageJsonFiles
}
