import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import chalk from 'chalk'
import type { PackageManager, PackageManagerInfo } from './types'

/**
 * Lock files in detection priority order — the single table both `detect()` and each
 * manager's `lockFile` read from. A manager's first entry is its current format.
 */
const LOCK_FILES: ReadonlyArray<{ file: string; pm: PackageManager }> = [
  { file: 'pnpm-lock.yaml', pm: 'pnpm' },
  // Bun >= 1.2 writes a text `bun.lock`; older versions wrote the binary `bun.lockb`.
  { file: 'bun.lock', pm: 'bun' },
  { file: 'bun.lockb', pm: 'bun' },
  { file: 'yarn.lock', pm: 'yarn' },
  { file: 'package-lock.json', pm: 'npm' },
]

function primaryLockFile(pm: PackageManager): string {
  // Every manager has an entry above, so find() never misses.
  return (LOCK_FILES.find((entry) => entry.pm === pm) as { file: string }).file
}

const PACKAGE_MANAGERS: Record<PackageManager, PackageManagerInfo> = {
  npm: {
    name: 'npm',
    displayName: 'npm',
    lockFile: primaryLockFile('npm'),
    workspaceFile: null, // Uses package.json workspaces field
    installCommand: 'npm install',
    color: chalk.red,
  },
  yarn: {
    name: 'yarn',
    displayName: 'yarn',
    lockFile: primaryLockFile('yarn'),
    workspaceFile: null, // Uses package.json workspaces field
    installCommand: 'yarn install',
    // Yarn Berry defaults to immutable installs in CI; --no-immutable lets the lockfile update.
    writeInstallCommand: 'yarn install --no-immutable',
    color: chalk.blue,
  },
  pnpm: {
    name: 'pnpm',
    displayName: 'pnpm',
    lockFile: primaryLockFile('pnpm'),
    workspaceFile: 'pnpm-workspace.yaml',
    installCommand: 'pnpm install',
    // pnpm defaults to --frozen-lockfile in CI; --no-frozen-lockfile lets the lockfile update.
    writeInstallCommand: 'pnpm install --no-frozen-lockfile',
    color: chalk.yellow,
  },
  bun: {
    name: 'bun',
    displayName: 'bun',
    lockFile: primaryLockFile('bun'),
    workspaceFile: null, // Uses package.json workspaces field
    installCommand: 'bun install',
    color: chalk.magenta,
  },
}

// biome-ignore lint/complexity/noStaticOnlyClass: intentional namespace-style API used throughout the codebase
export class PackageManagerDetector {
  /**
   * Detect package manager from packageManager field or lock files
   */
  static detect(cwd: string = process.cwd()): PackageManagerInfo {
    // 1. Check packageManager field in package.json
    const fromPackageJson = PackageManagerDetector.detectFromPackageJson(cwd)
    if (fromPackageJson) {
      return fromPackageJson
    }

    // 2. Check for lock files
    const fromLockFile = PackageManagerDetector.detectFromLockFiles(cwd)
    if (fromLockFile) {
      return fromLockFile
    }

    // 3. Fallback to npm. Warn on stderr so it never corrupts --json output on stdout.
    console.error(
      chalk.yellow(
        '⚠️  No package manager detected. Defaulting to npm. Consider adding a "packageManager" field to your package.json.'
      )
    )
    return PACKAGE_MANAGERS.npm
  }

  /**
   * Detect from package.json packageManager field
   */
  private static detectFromPackageJson(cwd: string): PackageManagerInfo | null {
    const packageJsonPath = join(cwd, 'package.json')
    if (!existsSync(packageJsonPath)) {
      return null
    }

    try {
      const content = readFileSync(packageJsonPath, 'utf-8')
      const packageJson = JSON.parse(content)

      if (packageJson.packageManager) {
        // Parse format: "pnpm@10.28.1" or "npm@9.0.0+sha512.abc..."
        const match = packageJson.packageManager.match(/^(npm|yarn|pnpm|bun)(@|$)/)
        if (match) {
          const pmName = match[1] as PackageManager
          return PACKAGE_MANAGERS[pmName]
        }
      }
    } catch {
      // Invalid package.json, continue to lock file detection
    }

    return null
  }

  /**
   * Detect from lock files (with priority and recency)
   */
  private static detectFromLockFiles(cwd: string): PackageManagerInfo | null {
    const existingLocks = LOCK_FILES.map(({ file, pm }) => ({
      pm: PACKAGE_MANAGERS[pm],
      path: join(cwd, file),
    }))
      .filter(({ path }) => existsSync(path))
      .map(({ pm, path }) => ({
        pm,
        path,
        mtime: statSync(path).mtime.getTime(),
      }))

    if (existingLocks.length === 0) {
      return null
    }

    // If multiple lock files, use most recently modified
    if (existingLocks.length > 1) {
      // stderr so it never corrupts --json output on stdout.
      console.error(
        chalk.yellow(
          '⚠️  Multiple lock files detected. Using most recently modified. Consider cleaning up unused lock files.'
        )
      )
      existingLocks.sort((a, b) => b.mtime - a.mtime)
    }

    return existingLocks[0].pm
  }

  /**
   * Get package manager info by name
   */
  static getInfo(name: PackageManager): PackageManagerInfo {
    return PACKAGE_MANAGERS[name]
  }

  /**
   * Find workspace root for any package manager
   */
  static findWorkspaceRoot(
    cwd: string = process.cwd(),
    packageManager: PackageManager
  ): string | null {
    const pmInfo = PACKAGE_MANAGERS[packageManager]
    let currentDir = cwd

    while (currentDir !== join(currentDir, '..')) {
      // Check for package manager-specific workspace file
      if (pmInfo.workspaceFile) {
        const workspaceFilePath = join(currentDir, pmInfo.workspaceFile)
        if (existsSync(workspaceFilePath)) {
          return currentDir
        }
      } else {
        // Check for package.json with workspaces field
        const packageJsonPath = join(currentDir, 'package.json')
        if (existsSync(packageJsonPath)) {
          try {
            const content = readFileSync(packageJsonPath, 'utf-8')
            const packageJson = JSON.parse(content)

            // Check if workspaces field exists and is non-empty
            if (packageJson.workspaces) {
              if (Array.isArray(packageJson.workspaces) && packageJson.workspaces.length > 0) {
                return currentDir
              } else if (
                typeof packageJson.workspaces === 'object' &&
                packageJson.workspaces.packages &&
                packageJson.workspaces.packages.length > 0
              ) {
                // Yarn berry format: { packages: [...] }
                return currentDir
              }
            }
          } catch {
            // Invalid package.json, continue searching
          }
        }
      }

      currentDir = join(currentDir, '..')
    }

    return null
  }

  /**
   * Check if directory is in a workspace
   */
  static isInWorkspace(cwd: string, packageManager: PackageManager): boolean {
    return PackageManagerDetector.findWorkspaceRoot(cwd, packageManager) !== null
  }
}
