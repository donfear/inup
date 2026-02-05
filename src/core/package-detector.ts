import * as semver from 'semver'
import { PackageInfo, PackageJson, UpgradeOptions } from '../types'
import {
  findPackageJson,
  readPackageJson,
  findAllPackageJsonFiles,
  collectAllDependenciesAsync,
  findClosestMinorVersion,
} from '../utils'
import { getAllPackageDataFromJsdelivr, getAllPackageData } from '../services'
import { DEFAULT_REGISTRY, isPackageIgnored } from '../config'
import { ConsoleUtils } from '../ui/utils'

export class PackageDetector {
  private packageJsonPath: string | null = null
  private packageJson: PackageJson | null = null
  private cwd: string
  private excludePatterns: string[]
  private ignorePackages: string[]

  constructor(options?: UpgradeOptions) {
    this.cwd = options?.cwd || process.cwd()
    this.excludePatterns = options?.excludePatterns || []
    this.ignorePackages = options?.ignorePackages || []
    this.packageJsonPath = findPackageJson(this.cwd)
    if (this.packageJsonPath) {
      this.packageJson = readPackageJson(this.packageJsonPath)
    }
  }

  public hasPackageJson(): boolean {
    return this.packageJsonPath !== null && this.packageJson !== null
  }

  public async getOutdatedPackages(): Promise<PackageInfo[]> {
    if (!this.packageJson) {
      throw new Error('No package.json found in current directory')
    }

    const packages: PackageInfo[] = []

    // Always check all package.json files recursively with timeout protection
    this.showProgress('🔍 Scanning repository for package.json files...')
    const allPackageJsonFiles = this.findPackageJsonFilesWithTimeout(30000) // 30 second timeout
    this.showProgress(
      `🔍 Found ${allPackageJsonFiles.length} package.json file${allPackageJsonFiles.length === 1 ? '' : 's'}`
    )

    // Step 2: Collect all dependencies from package.json files (parallelized)
    this.showProgress('🔍 Reading dependencies from package.json files...')
    const allDepsRaw = await collectAllDependenciesAsync(allPackageJsonFiles, {
      includePeerDeps: true,
      includeOptionalDeps: true,
    })

    // Step 3: Get unique package names while filtering out workspace references and ignored packages
    this.showProgress('🔍 Identifying unique packages...')
    const uniquePackageNames = new Set<string>()
    const allDeps: typeof allDepsRaw = []
    let ignoredCount = 0
    for (const dep of allDepsRaw) {
      if (this.isWorkspaceReference(dep.version)) {
        continue
      }
      if (this.ignorePackages.length > 0 && isPackageIgnored(dep.name, this.ignorePackages)) {
        ignoredCount++
        continue
      }
      allDeps.push(dep)
      uniquePackageNames.add(dep.name)
    }
    if (ignoredCount > 0) {
      this.showProgress(`🔍 Skipped ${ignoredCount} ignored package(s)`)
    }
    const packageNames = Array.from(uniquePackageNames)

    // Step 4: Fetch all package data in one call per package
    // Create a map of package names to their current versions for major version optimization
    const currentVersions = new Map<string, string>()
    for (const dep of allDeps) {
      // Use the first occurrence of each package's version
      if (!currentVersions.has(dep.name)) {
        currentVersions.set(dep.name, dep.version)
      }
    }

    const allPackageData =
      DEFAULT_REGISTRY === 'jsdelivr'
        ? await getAllPackageDataFromJsdelivr(
            packageNames,
            currentVersions,
            (_currentPackage: string, completed: number, total: number) => {
              this.showProgress(`🌐 Checking versions... (${completed}/${total} packages)`)
            }
          )
        : await getAllPackageData(
            packageNames,
            (_currentPackage: string, completed: number, total: number) => {
              this.showProgress(`🌐 Checking versions... (${completed}/${total} packages)`)
            }
          )

    try {
      for (const dep of allDeps) {
        try {
          const packageData = allPackageData.get(dep.name)
          if (!packageData) continue

          const { latestVersion, allVersions } = packageData

          // Find closest minor version (same major, higher minor) that satisfies the current range
          // Falls back to patch updates if no minor updates are available
          const closestMinorVersion = findClosestMinorVersion(dep.version, allVersions)

          const installedClean = semver.coerce(dep.version)?.version || dep.version
          const minorClean = closestMinorVersion
            ? semver.coerce(closestMinorVersion)?.version || closestMinorVersion
            : null
          const latestClean = semver.coerce(latestVersion)?.version || latestVersion

          const hasRangeUpdate = minorClean !== null && minorClean !== installedClean
          const hasMajorUpdate = semver.major(latestClean) > semver.major(installedClean)
          const isOutdated = hasRangeUpdate || hasMajorUpdate

          packages.push({
            name: dep.name,
            currentVersion: dep.version, // Keep original version specifier with prefix
            rangeVersion: closestMinorVersion || dep.version,
            latestVersion,
            type: dep.type as
              | 'dependencies'
              | 'devDependencies'
              | 'optionalDependencies'
              | 'peerDependencies',
            packageJsonPath: dep.packageJsonPath,
            isOutdated,
            hasRangeUpdate,
            hasMajorUpdate,
          })
        } catch (error) {
          // Skip packages that can't be checked (private packages, etc.)
          packages.push({
            name: dep.name,
            currentVersion: dep.version,
            rangeVersion: 'unknown',
            latestVersion: 'unknown',
            type: dep.type as
              | 'dependencies'
              | 'devDependencies'
              | 'optionalDependencies'
              | 'peerDependencies',
            packageJsonPath: dep.packageJsonPath,
            isOutdated: false,
            hasRangeUpdate: false,
            hasMajorUpdate: false,
          })
        }
      }

      return packages
    } catch (error) {
      this.showProgress('❌ Failed to check packages\n')
      throw error
    }
  }

  private findPackageJsonFilesWithTimeout(timeoutMs: number): string[] {
    // Synchronous file search with depth limiting and symlink protection
    // The timeout parameter is kept for future async implementation
    try {
      return findAllPackageJsonFiles(
        this.cwd,
        this.excludePatterns,
        10,
        (currentDir: string, foundCount: number) => {
          // Show scanning progress with current directory and count
          const truncatedDir = currentDir.length > 50 ? '...' + currentDir.slice(-47) : currentDir
          this.showProgress(`🔍 Scanning ${truncatedDir} (found ${foundCount})`)
        }
      )
    } catch (err) {
      throw new Error(
        `Failed to scan for package.json files: ${err}. Try using --exclude patterns to skip problematic directories.`
      )
    }
  }

  private isWorkspaceReference(version: string): boolean {
    // Check for common workspace reference patterns
    return (
      version.includes('workspace:') ||
      version === '*' ||
      version.startsWith('file:') ||
      version.startsWith('link:') ||
      version.startsWith('github:') ||
      version.startsWith('gitlab:') ||
      version.startsWith('bitbucket:')
    )
  }

  private showProgress(message: string): void {
    ConsoleUtils.showProgress(message)
  }

  public getOutdatedPackagesOnly(packages: PackageInfo[]): PackageInfo[] {
    return packages.filter((pkg) => pkg.isOutdated)
  }
}
