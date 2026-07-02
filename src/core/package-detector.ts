import chalk from 'chalk'
import * as semver from 'semver'
import {
  DependencyEntry,
  PackageInfo,
  PackageLoadProgress,
  StreamOutdatedPackagesBatchItem,
  StreamOutdatedPackagesCallback,
  StreamOutdatedPackagesInitialPayload,
  UpgradeOptions,
} from '../shared/types'
import {
  findPackageJson,
  readPackageJson,
  findAllPackageJsonFilesAsync,
  collectAllDependenciesAsync,
} from '../shared/fs'
import { findClosestMinorVersion } from '../shared/versions'
import { fetchPackageVersions, PackageVersionData } from '../services'
import { isPackageIgnored, POOL_CONNECTIONS } from '../shared/config'
import { ConsoleUtils } from '../shared/terminal'
import { debugLog } from '../shared/debug-logger'
import { getPerformanceTracker, isPerfLoggingEnabled } from '../features/debug'

interface PreparedDependencies {
  allDependencies: DependencyEntry[]
  uniquePackages: string[]
  currentVersions: Map<string, string>
}

export class PackageDetector {
  private packageJsonPath: string | null = null
  private packageJson: Record<string, unknown> | null = null
  private cwd: string
  private excludePatterns: string[]
  private scanDirs: string[]
  private ignorePackages: string[]
  private maxDepth: number

  private readonly batchSize = 10
  private readonly maxConcurrency = 10
  private readonly adaptive: boolean

  constructor(options?: UpgradeOptions) {
    this.cwd = options?.cwd || process.cwd()
    this.excludePatterns = options?.excludePatterns || []
    this.scanDirs = options?.scanDirs || []
    this.ignorePackages = options?.ignorePackages || []
    this.maxDepth = options?.maxDepth ?? 10
    this.adaptive = options?.adaptive ?? true
    this.packageJsonPath = findPackageJson(this.cwd)
    if (this.packageJsonPath) {
      this.packageJson = readPackageJson(this.packageJsonPath)
    }
  }

  public hasPackageJson(): boolean {
    return this.packageJsonPath !== null && this.packageJson !== null
  }

  /**
   * The resolved fetch configuration for this run, for perf logging. Exposes the
   * exact values handed to the registry fetcher so a logged run is reproducible.
   */
  public getPerfConfig(): {
    cwd: string
    adaptive: boolean
    maxConcurrency: number
    batchSize: number
    poolConnections: number
  } {
    return {
      cwd: this.cwd,
      adaptive: this.adaptive,
      maxConcurrency: this.maxConcurrency,
      batchSize: this.batchSize,
      poolConnections: POOL_CONNECTIONS,
    }
  }

  public async getOutdatedPackages(): Promise<PackageInfo[]> {
    const packages: PackageInfo[] = []

    await this.streamOutdatedPackages((event) => {
      if (event.type === 'batch') {
        event.payload.batch.forEach((item) => {
          packages.push(...item.packageInfo)
        })
      } else if (event.type === 'complete') {
        packages.splice(0, packages.length, ...event.payload.packages)
      }
    })

    return packages
  }

  public async streamOutdatedPackages(
    onEvent: StreamOutdatedPackagesCallback
  ): Promise<PackageInfo[]> {
    if (!this.packageJson) {
      throw new Error('No package.json found in current directory')
    }

    const t0 = Date.now()
    debugLog.info('PackageDetector', `Starting scan in ${this.cwd}`)

    const prepared = await this.prepareDependencies()
    const initialPayload: StreamOutdatedPackagesInitialPayload = {
      allDependencies: prepared.allDependencies,
      uniquePackages: prepared.uniquePackages,
      currentVersions: prepared.currentVersions,
      progress: this.createProgressSnapshot(prepared.uniquePackages.length, 0, 0, true),
    }

    onEvent({ type: 'initial', payload: initialPayload })

    const packageLookup = new Map<string, PackageInfo[]>()
    let resolved = 0
    let failed = 0
    const performanceTracker = getPerformanceTracker()
    let batchIndex = 0
    let lastBatchEndAt = Date.now()

    const tFetch = Date.now()
    debugLog.info('PackageDetector', 'fetching version data via npm registry in batches')

    await fetchPackageVersions(prepared.uniquePackages, {
      currentVersions: prepared.currentVersions,
      batchSize: this.batchSize,
      maxConcurrency: this.maxConcurrency,
      adaptive: this.adaptive,
      onControlTick: (tick) => performanceTracker.recordControlTick(tick),
      onPackageTiming: isPerfLoggingEnabled()
        ? (name, latencyMs) => performanceTracker.recordPackageTiming({ name, latencyMs })
        : undefined,
      onBatchReady: (batch) => {
        const batchStart = lastBatchEndAt
        let batchFailedCount = 0
        const batchItems: StreamOutdatedPackagesBatchItem[] = batch.map((batchItem) => {
          const packageInfo = this.resolvePackageGroup(
            batchItem.packageName,
            prepared.allDependencies,
            batchItem.data
          )
          packageLookup.set(batchItem.packageName, packageInfo)
          resolved++

          const isFailed = batchItem.data.latestVersion === 'unknown'
          if (isFailed) {
            failed++
            batchFailedCount++
            performanceTracker.recordFailedPackage(batchItem.packageName)
          }

          return {
            packageName: batchItem.packageName,
            packageInfo,
            failed: isFailed,
          }
        })

        const batchEnd = Date.now()
        performanceTracker.recordBatch({
          index: batchIndex++,
          size: batch.length,
          durationMs: batchEnd - batchStart,
          failedCount: batchFailedCount,
        })
        lastBatchEndAt = batchEnd
        performanceTracker.recordCounts({ resolved, failed })

        const progress = this.createProgressSnapshot(
          prepared.uniquePackages.length,
          resolved,
          failed,
          resolved < prepared.uniquePackages.length
        )

        onEvent({
          type: 'batch',
          payload: {
            batch: batchItems,
            progress,
          },
        })
      },
    })

    debugLog.perf(
      'PackageDetector',
      `registry fetch (${resolved}/${prepared.uniquePackages.length} resolved)`,
      tFetch
    )
    performanceTracker.recordPhaseDuration('registryFetch', Date.now() - tFetch)

    const finalPackages = prepared.uniquePackages.flatMap(
      (packageName) => packageLookup.get(packageName) ?? []
    )
    const progress = this.createProgressSnapshot(
      prepared.uniquePackages.length,
      resolved,
      failed,
      false
    )

    debugLog.perf(
      'PackageDetector',
      `total scan complete (${finalPackages.filter((p) => p.isOutdated).length} outdated of ${finalPackages.length} deps)`,
      t0
    )

    onEvent({
      type: 'complete',
      payload: {
        packages: finalPackages,
        progress,
      },
    })

    ConsoleUtils.clearProgress()
    return finalPackages
  }

  private async prepareDependencies(): Promise<PreparedDependencies> {
    const performanceTracker = getPerformanceTracker()

    this.showProgress('🔍 Scanning repository for package.json files...')
    const tScan = Date.now()
    const allPackageJsonFiles = await this.findPackageJsonFilesWithTimeout(30000)
    debugLog.perf('PackageDetector', `file scan (${allPackageJsonFiles.length} files)`, tScan, {
      files: allPackageJsonFiles,
    })
    performanceTracker.recordPhaseDuration('discovery', Date.now() - tScan)
    performanceTracker.recordCounts({ packageJsonFiles: allPackageJsonFiles.length })
    this.showProgress(
      `🔍 Found ${allPackageJsonFiles.length} package.json file${allPackageJsonFiles.length === 1 ? '' : 's'}`
    )

    this.showProgress('🔍 Reading dependencies from package.json files...')
    const tDeps = Date.now()
    const allDepsRaw = await collectAllDependenciesAsync(allPackageJsonFiles, {
      includePeerDeps: true,
      includeOptionalDeps: true,
    })
    debugLog.perf('PackageDetector', `dependency collection (${allDepsRaw.length} raw deps)`, tDeps)
    performanceTracker.recordPhaseDuration('depCollection', Date.now() - tDeps)
    performanceTracker.recordCounts({ rawDependencies: allDepsRaw.length })

    this.showProgress('🔍 Identifying unique packages...')
    const tFilter = Date.now()
    const uniquePackageNames = new Set<string>()
    const allDependencies: DependencyEntry[] = []
    let ignoredCount = 0
    const seenWorkspaceRefs = new Set<string>()
    const seenIgnored = new Set<string>()

    for (const dep of allDepsRaw) {
      if (this.isWorkspaceReference(dep.version)) {
        const key = `${dep.name}@${dep.version}`
        if (!seenWorkspaceRefs.has(key)) {
          seenWorkspaceRefs.add(key)
          debugLog.info('PackageDetector', `skipping workspace ref: ${key}`)
        }
        continue
      }

      if (this.ignorePackages.length > 0 && isPackageIgnored(dep.name, this.ignorePackages)) {
        ignoredCount++
        if (!seenIgnored.has(dep.name)) {
          seenIgnored.add(dep.name)
          debugLog.info('PackageDetector', `ignoring package: ${dep.name}`)
        }
        continue
      }

      allDependencies.push({
        name: dep.name,
        version: dep.version,
        type: dep.type as DependencyEntry['type'],
        packageJsonPath: dep.packageJsonPath,
      })
      uniquePackageNames.add(dep.name)
    }

    if (ignoredCount > 0) {
      this.showProgress(`🔍 Skipped ${ignoredCount} ignored package(s)`)
    }

    const uniquePackages = Array.from(uniquePackageNames).sort((a, b) => {
      const aIsScoped = a.startsWith('@')
      const bIsScoped = b.startsWith('@')
      if (aIsScoped && !bIsScoped) return -1
      if (!aIsScoped && bIsScoped) return 1
      return a.localeCompare(b)
    })

    debugLog.info(
      'PackageDetector',
      `${uniquePackages.length} unique packages to check, ${ignoredCount} ignored`
    )
    performanceTracker.recordPhaseDuration('filter', Date.now() - tFilter)
    performanceTracker.recordCounts({
      uniquePackages: uniquePackages.length,
      ignoredPackages: ignoredCount,
      workspaceRefsSkipped: seenWorkspaceRefs.size,
    })

    const currentVersions = new Map<string, string>()
    for (const dep of allDependencies) {
      if (!currentVersions.has(dep.name)) {
        currentVersions.set(dep.name, dep.version)
      }
    }

    return {
      allDependencies,
      uniquePackages,
      currentVersions,
    }
  }

  private resolvePackageGroup(
    packageName: string,
    allDependencies: DependencyEntry[],
    packageData: PackageVersionData | undefined
  ): PackageInfo[] {
    const dependencies = allDependencies.filter((dep) => dep.name === packageName)
    const loggedNoData = new Set<string>()
    const loggedOutdated = new Set<string>()

    return dependencies.map((dep) => {
      try {
        if (!packageData || packageData.latestVersion === 'unknown') {
          if (!loggedNoData.has(dep.name)) {
            loggedNoData.add(dep.name)
            debugLog.warn(
              'PackageDetector',
              `no data returned for ${dep.name} — marking unavailable`
            )
          }

          return this.createFailedPackageInfo(dep)
        }

        const { latestVersion, allVersions } = packageData
        const closestMinorVersion = findClosestMinorVersion(dep.version, allVersions)

        const installedClean = semver.coerce(dep.version)?.version || dep.version
        const minorClean = closestMinorVersion
          ? semver.coerce(closestMinorVersion)?.version || closestMinorVersion
          : null
        const latestClean = semver.coerce(latestVersion)?.version || latestVersion

        const hasRangeUpdate = minorClean !== null && minorClean !== installedClean
        const hasMajorUpdate =
          semver.valid(latestClean) !== null &&
          semver.valid(installedClean) !== null &&
          semver.major(latestClean) > semver.major(installedClean)
        const isOutdated = hasRangeUpdate || hasMajorUpdate

        if (isOutdated) {
          const outdatedKey = `${dep.name}@${dep.version}`
          if (!loggedOutdated.has(outdatedKey)) {
            loggedOutdated.add(outdatedKey)
            debugLog.info(
              'PackageDetector',
              `outdated: ${dep.name} ${dep.version} → range:${closestMinorVersion ?? '-'} latest:${latestVersion}`
            )
          }
        }

        return {
          name: dep.name,
          currentVersion: dep.version,
          rangeVersion: closestMinorVersion || dep.version,
          latestVersion,
          type: dep.type,
          packageJsonPath: dep.packageJsonPath,
          isOutdated,
          hasRangeUpdate,
          hasMajorUpdate,
          allVersions,
          deprecated: packageData.deprecated,
          enginesNode: packageData.enginesNode,
        }
      } catch (error) {
        debugLog.error('PackageDetector', `error processing ${dep.name}`, error)
        return this.createFailedPackageInfo(dep)
      }
    })
  }

  private createFailedPackageInfo(dep: DependencyEntry): PackageInfo {
    return {
      name: dep.name,
      currentVersion: dep.version,
      rangeVersion: 'unknown',
      latestVersion: 'unknown',
      type: dep.type,
      packageJsonPath: dep.packageJsonPath,
      isOutdated: false,
      hasRangeUpdate: false,
      hasMajorUpdate: false,
    }
  }

  private createProgressSnapshot(
    total: number,
    resolved: number,
    failed: number,
    isLoading: boolean
  ): PackageLoadProgress {
    return {
      discovered: total,
      resolved,
      total,
      failed,
      isLoading,
    }
  }

  private async findPackageJsonFilesWithTimeout(timeoutMs: number): Promise<string[]> {
    const skippedPackageDirs = new Set<string>()
    try {
      let timeoutId: NodeJS.Timeout | undefined

      try {
        const files = await Promise.race([
          findAllPackageJsonFilesAsync(
            this.cwd,
            this.excludePatterns,
            this.maxDepth,
            (currentDir: string, foundCount: number) => {
              const truncatedDir =
                currentDir.length > 50 ? '...' + currentDir.slice(-47) : currentDir
              this.showProgress(`🔍 Scanning ${truncatedDir} (found ${foundCount})`)
            },
            {
              scanDirs: this.scanDirs,
              onSkippedPackageDir: (relativePath) => skippedPackageDirs.add(relativePath),
            }
          ),
          new Promise<string[]>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error(`Scan timed out after ${timeoutMs}ms`))
            }, timeoutMs)
            timeoutId.unref?.()
          }),
        ])
        this.warnSkippedPackageDirs(skippedPackageDirs)
        return files
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
      }
    } catch (err) {
      throw new Error(
        `Failed to scan for package.json files: ${err}. Try using --exclude patterns to skip problematic directories.`
      )
    }
  }

  /**
   * Warn (once per directory, after the scan) about package.json-bearing directories that the
   * default skip list pruned, so the user can re-include them via `.inuprc`'s `scanDirs`.
   * Emitted after scanning so it does not corrupt the progress spinner output.
   */
  private warnSkippedPackageDirs(skippedPackageDirs: Set<string>): void {
    if (skippedPackageDirs.size === 0) {
      return
    }
    const list = Array.from(skippedPackageDirs).sort()
    console.warn(
      chalk.yellow(
        `⚠️  Skipped ${list.length} package.json-bearing director${
          list.length === 1 ? 'y' : 'ies'
        } matching the default ignore list:\n` +
          list.map((dir) => `   - ${dir}`).join('\n') +
          `\n   Add the directory name(s) to "scanDirs" in .inuprc to include them.`
      )
    )
  }

  private isWorkspaceReference(version: string): boolean {
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
