import { existsSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

export interface PackageManagerInfo {
  name: PackageManager
  displayName: string
  lockFile: string
  workspaceFile: string | null // null means check package.json workspaces field
  installCommand: string
  color: typeof chalk
}

const PACKAGE_MANAGERS: Record<PackageManager, PackageManagerInfo> = {
  npm: {
    name: 'npm',
    displayName: 'npm',
    lockFile: 'package-lock.json',
    workspaceFile: null, // Uses package.json workspaces field
    installCommand: 'npm install',
    color: chalk.red,
  },
  yarn: {
    name: 'yarn',
    displayName: 'yarn',
    lockFile: 'yarn.lock',
    workspaceFile: null, // Uses package.json workspaces field
    installCommand: 'yarn install',
    color: chalk.blue,
  },
  pnpm: {
    name: 'pnpm',
    displayName: 'pnpm',
    lockFile: 'pnpm-lock.yaml',
    workspaceFile: 'pnpm-workspace.yaml',
    installCommand: 'pnpm install',
    color: chalk.yellow,
  },
  bun: {
    name: 'bun',
    displayName: 'bun',
    lockFile: 'bun.lockb',
    workspaceFile: null, // Uses package.json workspaces field
    installCommand: 'bun install',
    color: chalk.magenta,
  },
}

export class PackageManagerDetector {
  /**
   * Detect package manager from packageManager field or lock files
   */
  static detect(cwd: string = process.cwd()): PackageManagerInfo {
    // 1. Check packageManager field in package.json
    const fromPackageJson = this.detectFromPackageJson(cwd)
    if (fromPackageJson) {
      return fromPackageJson
    }

    // 2. Check for lock files
    const fromLockFile = this.detectFromLockFiles(cwd)
    if (fromLockFile) {
      return fromLockFile
    }

    // 3. Fallback to npm
    console.log(
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
    } catch (error) {
      // Invalid package.json, continue to lock file detection
    }

    return null
  }

  /**
   * Detect from lock files (with priority and recency)
   */
  private static detectFromLockFiles(cwd: string): PackageManagerInfo | null {
    const lockFileChecks = [
      { pm: PACKAGE_MANAGERS.pnpm, path: join(cwd, 'pnpm-lock.yaml') },
      { pm: PACKAGE_MANAGERS.bun, path: join(cwd, 'bun.lockb') },
      { pm: PACKAGE_MANAGERS.yarn, path: join(cwd, 'yarn.lock') },
      { pm: PACKAGE_MANAGERS.npm, path: join(cwd, 'package-lock.json') },
    ]

    const existingLocks = lockFileChecks
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
      console.log(
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
          } catch (error) {
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
    return this.findWorkspaceRoot(cwd, packageManager) !== null
  }
}
