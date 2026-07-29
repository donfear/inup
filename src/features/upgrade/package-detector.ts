import chalk from 'chalk'
import * as semver from 'semver'
import { isPackageIgnored, POOL_CONNECTIONS } from '../../shared/config'
import { configManager } from '../../shared/config/user-config'
import { debugLog } from '../../shared/debug-logger'
import {
  collectAllDependenciesAsync,
  findAllPackageJsonFilesAsync,
  findPackageJson,
  readPackageJson,
} from '../../shared/fs'
import type { ControlTick } from '../../shared/http/controller-contract'
import { isCatalogReference, PnpmCatalogs } from '../../shared/pnpm-catalogs'
import { fetchPackageVersions, type PackageVersionData } from '../../shared/registry/npm-registry'
import { ConsoleUtils } from '../../shared/terminal'
import type {
  DependencyEntry,
  NetworkProfile,
  PackageInfo,
  PackageLoadProgress,
  StreamOutdatedPackagesBatchItem,
  StreamOutdatedPackagesCallback,
  StreamOutdatedPackagesInitialPayload,
  UpgradeOptions,
} from '../../shared/types'
import {
  buildRangeCandidates,
  findClosestMinorVersion,
  highestOverallVersion,
  parseCurrentVersion,
  toComparableVersion,
} from '../../shared/versions'
import { getPerformanceTracker, isPerfLoggingEnabled } from '../debug'

// Slow-connection heuristic: the hill-climb controller (HILL_CLIMB_TUNING:
// floor 3, ceil 24) settling at/below this limit in a down state, or a latency
// EWMA above this, reads as a slow link for the loading UI.
const SLOW_NETWORK_LIMIT_MAX = 6
const SLOW_NETWORK_EWMA_MS = 1000

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
  private ignoreMajorPackages: string[]
  private maxDepth: number

  private readonly batchSize = 10
  private readonly maxConcurrency = 10
  private readonly adaptive: boolean
  /** Pinned parallelism (flag / .inuprc); undefined lets the controller adapt. */
  private readonly concurrency?: number
  private readonly controllerMode: 'aimd' | 'hillclimb'
  /** INUP_NET_PROFILE=0 disables learned-profile read AND write (clean A/B runs). */
  private readonly profilePersistenceEnabled: boolean
  private readonly networkProfile: NetworkProfile | null
  /** Latest control decision of the current run, for the slow-network hint. */
  private lastControlTick: ControlTick | null = null

  constructor(options?: UpgradeOptions) {
    this.cwd = options?.cwd || process.cwd()
    this.excludePatterns = options?.excludePatterns || []
    this.scanDirs = options?.scanDirs || []
    this.ignorePackages = options?.ignorePackages || []
    this.ignoreMajorPackages = options?.ignoreMajorPackages || []
    this.maxDepth = options?.maxDepth ?? 10
    this.adaptive = options?.adaptive ?? true
    this.concurrency = options?.concurrency
    this.controllerMode = process.env.INUP_CONTROLLER === 'aimd' ? 'aimd' : 'hillclimb'
    this.profilePersistenceEnabled = process.env.INUP_NET_PROFILE !== '0'
    this.networkProfile = this.profilePersistenceEnabled ? configManager.getNetworkProfile() : null
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
    controllerMode: 'aimd' | 'hillclimb'
    pinnedConcurrency: number | null
    hadNetworkProfile: boolean
    profileLearnedLimit: number | null
  } {
    return {
      cwd: this.cwd,
      adaptive: this.adaptive,
      maxConcurrency: this.maxConcurrency,
      batchSize: this.batchSize,
      poolConnections: POOL_CONNECTIONS,
      controllerMode: this.controllerMode,
      pinnedConcurrency: this.concurrency ?? null,
      hadNetworkProfile: this.networkProfile !== null,
      profileLearnedLimit: this.networkProfile?.learnedLimit ?? null,
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
      concurrency: this.concurrency,
      controllerMode: this.controllerMode,
      networkProfile: this.networkProfile,
      onNetworkProfile: this.profilePersistenceEnabled
        ? (profile) => configManager.setNetworkProfile(profile)
        : undefined,
      onControlTick: (tick) => {
        this.lastControlTick = tick
        performanceTracker.recordControlTick(tick)
      },
      onPackageTiming: isPerfLoggingEnabled()
        ? (name, latencyMs) => performanceTracker.recordPackageTiming({ name, latencyMs })
        : undefined,
      onBatchReady: (batch) => {
        // First-wins in the tracker; headless runs get the phase from here,
        // the interactive runner's own mark becomes a no-op duplicate.
        performanceTracker.mark('firstBatch')
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

    // pnpm catalogs: `"react": "catalog:"` gets its real range from
    // pnpm-workspace.yaml. Each catalog entry becomes ONE upgradable dependency
    // sourced from that file, no matter how many workspace packages reference it.
    const catalogs = PnpmCatalogs.load(this.cwd)
    // Entries here always carry catalogReferencedBy (set on first-seen below),
    // so require it in the value type — that lets re-references push onto the
    // array without an optional-fallback branch.
    const seenCatalogEntries = new Map<
      string,
      DependencyEntry & { catalogReferencedBy: string[] }
    >()

    for (const rawDep of allDepsRaw) {
      let dep: DependencyEntry = {
        name: rawDep.name,
        version: rawDep.version,
        type: rawDep.type as DependencyEntry['type'],
        packageJsonPath: rawDep.packageJsonPath,
      }

      if (isCatalogReference(rawDep.version)) {
        // A catalog ref resolves its range from pnpm-workspace.yaml. If that
        // file was absent (catalogs === null) or the entry is missing, we can't
        // resolve a range — warn and skip.
        const resolution = catalogs?.resolve(rawDep.name, rawDep.version)
        if (!catalogs || !resolution) {
          debugLog.warn(
            'PackageDetector',
            `skipping unresolvable catalog ref: ${rawDep.name}@${rawDep.version}`
          )
          continue
        }
        const catalogKey = `${resolution.catalog}:${rawDep.name}`
        const existing = seenCatalogEntries.get(catalogKey)
        if (existing) {
          // Same catalog entry, another referencing package: remember who uses
          // it (for the info modal's Used-by tab) but keep the single entry.
          if (!existing.catalogReferencedBy.includes(rawDep.packageJsonPath)) {
            existing.catalogReferencedBy.push(rawDep.packageJsonPath)
          }
          continue
        }
        const catalogEntry: DependencyEntry & { catalogReferencedBy: string[] } = {
          name: rawDep.name,
          version: resolution.range,
          type: rawDep.type as DependencyEntry['type'],
          packageJsonPath: catalogs.path,
          catalog: resolution.catalog,
          catalogEntries: catalogs.entriesOf(resolution.catalog),
          catalogReferencedBy: [rawDep.packageJsonPath],
        }
        seenCatalogEntries.set(catalogKey, catalogEntry)
        dep = catalogEntry
      }

      if (this.isNonRegistrySpecifier(dep.version)) {
        const key = `${dep.name}@${dep.version}`
        if (!seenWorkspaceRefs.has(key)) {
          seenWorkspaceRefs.add(key)
          debugLog.info('PackageDetector', `skipping non-registry specifier: ${key}`)
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

      allDependencies.push(dep)
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

        const { latestVersion, allVersions, prereleaseVersions } = packageData
        const installed = parseCurrentVersion(dep.version)
        const currentIsPrerelease = (installed?.prerelease.length ?? 0) > 0

        // A stable install never upgrades onto the prerelease channel.
        // latestVersion is a prerelease only for prerelease-only packages
        // (zero stable publishes) — report those unavailable, exactly as
        // before prerelease support existed.
        if (!currentIsPrerelease && semver.prerelease(latestVersion) !== null) {
          return this.createFailedPackageInfo(dep)
        }

        // Stable installs see the stable pool untouched; prerelease installs
        // also see prereleases on their own major.minor.patch tuple (npm range
        // semantics: ^1.0.0-beta.2 satisfies 1.0.0-rc.3).
        const candidateVersions = buildRangeCandidates(installed, allVersions, prereleaseVersions)
        const closestMinorVersion = findClosestMinorVersion(dep.version, candidateVersions)
        // On the prerelease channel "latest" is the newest publish on any
        // channel — a beta user is told about the rc and about the final.
        const effectiveLatest = currentIsPrerelease
          ? (highestOverallVersion(allVersions, prereleaseVersions) ?? latestVersion)
          : latestVersion

        const installedClean = installed?.version || dep.version
        const minorClean = closestMinorVersion
          ? toComparableVersion(closestMinorVersion) || closestMinorVersion
          : null
        const latestClean = toComparableVersion(effectiveLatest) || effectiveLatest

        const hasRangeUpdate = minorClean !== null && minorClean !== installedClean
        const latestValid = semver.valid(latestClean) !== null
        const crossesMajor =
          latestValid &&
          semver.valid(installedClean) !== null &&
          semver.major(latestClean) > semver.major(installedClean)
        let hasMajorUpdate: boolean
        if (currentIsPrerelease) {
          // Prerelease channel: the latest column shows anything the range
          // bump cannot reach — including same-major cross-tuple prereleases
          // (1.0.0-beta.2 → 1.1.0-alpha.1) that never cross a major. gt()
          // keeps the interactive UI consistent with `--target latest`.
          const rangeCeiling = minorClean ?? installedClean
          hasMajorUpdate =
            latestValid &&
            semver.valid(rangeCeiling) !== null &&
            semver.gt(latestClean, rangeCeiling)
        } else {
          hasMajorUpdate = crossesMajor
        }

        // .inuprc ignoreMajor: majors for matched packages are never offered.
        // A package whose only update is a new major counts as up to date;
        // in-range minor/patch updates still surface normally. Only true
        // major crossings are suppressed — a same-major prerelease jump on
        // the prerelease channel is not a major.
        let majorIgnored = false
        if (
          hasMajorUpdate &&
          crossesMajor &&
          this.ignoreMajorPackages.length > 0 &&
          isPackageIgnored(dep.name, this.ignoreMajorPackages)
        ) {
          majorIgnored = true
          hasMajorUpdate = false
        }

        const isOutdated = hasRangeUpdate || hasMajorUpdate

        if (isOutdated) {
          const outdatedKey = `${dep.name}@${dep.version}`
          if (!loggedOutdated.has(outdatedKey)) {
            loggedOutdated.add(outdatedKey)
            debugLog.info(
              'PackageDetector',
              `outdated: ${dep.name} ${dep.version} → range:${closestMinorVersion ?? '-'} latest:${effectiveLatest}`
            )
          }
        }

        return {
          name: dep.name,
          currentVersion: dep.version,
          rangeVersion: closestMinorVersion || dep.version,
          latestVersion: effectiveLatest,
          type: dep.type,
          packageJsonPath: dep.packageJsonPath,
          catalog: dep.catalog,
          catalogEntries: dep.catalogEntries,
          catalogReferencedBy: dep.catalogReferencedBy,
          isOutdated,
          hasRangeUpdate,
          hasMajorUpdate,
          majorIgnored,
          allVersions: candidateVersions,
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
      catalog: dep.catalog,
      catalogEntries: dep.catalogEntries,
      catalogReferencedBy: dep.catalogReferencedBy,
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
      slowNetwork: this.isSlowNetwork(),
    }
  }

  /** A settled-low limit or high latency EWMA reads as a slow connection. */
  private isSlowNetwork(): boolean {
    const tick = this.lastControlTick
    if (!tick) return false
    const settledLow =
      (tick.state === 'hold' || tick.state === 'climb-down') && tick.limit <= SLOW_NETWORK_LIMIT_MAX
    return settledLow || tick.ewmaMs > SLOW_NETWORK_EWMA_MS
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
                currentDir.length > 50 ? `...${currentDir.slice(-47)}` : currentDir
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

  /**
   * Specifiers that don't point at a plain registry range, so there is nothing to resolve or
   * upgrade: workspace/file/link refs, git hosts and URLs, tarball URLs, and `npm:` aliases.
   * An `npm:` alias in particular must never be looked up under its alias name — the packument
   * for that name is a different (or nonexistent) package.
   */
  private isNonRegistrySpecifier(version: string): boolean {
    return (
      version.includes('workspace:') ||
      version === '*' ||
      version.startsWith('file:') ||
      version.startsWith('link:') ||
      version.startsWith('github:') ||
      version.startsWith('gitlab:') ||
      version.startsWith('bitbucket:') ||
      version.startsWith('npm:') ||
      version.startsWith('git:') ||
      version.startsWith('git+') ||
      version.startsWith('http:') ||
      version.startsWith('https:')
    )
  }

  private showProgress(message: string): void {
    ConsoleUtils.showProgress(message)
  }

  public getOutdatedPackagesOnly(packages: PackageInfo[]): PackageInfo[] {
    return packages.filter((pkg) => pkg.isOutdated)
  }
}
