import chalk from 'chalk'
import * as semver from 'semver'
import { isPackageIgnored } from '../../shared/config'
import { configManager } from '../../shared/config/user-config'
import { applyReleaseAgeCooldown } from '../../shared/cooldown'
import { debugLog } from '../../shared/debug-logger'
import {
  collectAllDependenciesAsync,
  findAllPackageJsonFilesAsync,
  findPackageJson,
  readPackageJson,
} from '../../shared/fs'
import type { ControlTick } from '../../shared/http/hill-climb-controller'
import { isCatalogReference, PnpmCatalogs } from '../../shared/pnpm-catalogs'
import { fetchPackageVersions, type PackageVersionData } from '../../shared/registry/npm-registry'
import type {
  CooldownHold,
  DependencyEntry,
  NetworkProfile,
  PackageInfo,
  PackageLoadProgress,
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
import { getPerformanceTracker } from '../debug'

// Slow-connection heuristic: the hill-climb controller (HILL_CLIMB_TUNING:
// floor 3, ceil 24) settling at/below this limit in a down state, or a latency
// EWMA above this, reads as a slow link for the loading UI.
const SLOW_NETWORK_LIMIT_MAX = 6
const SLOW_NETWORK_EWMA_MS = 1000

interface PreparedDependencies {
  allDependencies: DependencyEntry[]
  dependenciesByName: Map<string, DependencyEntry[]>
  uniquePackages: string[]
  currentVersions: Map<string, string>
}

/** The fields a PackageInfo carries over from where the dependency is declared. */
function declarationFields(
  dep: DependencyEntry
): Pick<
  PackageInfo,
  'type' | 'packageJsonPath' | 'catalog' | 'catalogEntries' | 'catalogReferencedBy'
> {
  return {
    type: dep.type,
    packageJsonPath: dep.packageJsonPath,
    catalog: dep.catalog,
    catalogEntries: dep.catalogEntries,
    catalogReferencedBy: dep.catalogReferencedBy,
  }
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
  private minimumReleaseAge: number
  private minimumReleaseAgeExclude: string[]

  /** Pinned parallelism (flag / .inuprc); undefined lets the controller adapt. */
  private readonly concurrency?: number
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
    this.concurrency = options?.concurrency
    this.networkProfile = configManager.getNetworkProfile()
    this.minimumReleaseAge = options?.minimumReleaseAge ?? 0
    this.minimumReleaseAgeExclude = options?.minimumReleaseAgeExclude ?? []
    this.packageJsonPath = findPackageJson(this.cwd)
    if (this.packageJsonPath) {
      this.packageJson = readPackageJson(this.packageJsonPath)
    }
  }

  public hasPackageJson(): boolean {
    return this.packageJsonPath !== null && this.packageJson !== null
  }

  public async getOutdatedPackages(): Promise<PackageInfo[]> {
    const packages: PackageInfo[] = []

    await this.streamOutdatedPackages((event) => {
      if (event.type === 'warning') console.warn(chalk.yellow(event.payload.message))
      if (event.type === 'package') {
        packages.push(...event.payload.packageInfo)
      } else if (event.type === 'complete') {
        packages.splice(0, packages.length, ...event.payload.packages)
      }
    })

    return packages
  }

  public async streamOutdatedPackages(
    callback: StreamOutdatedPackagesCallback,
    signal?: AbortSignal
  ): Promise<PackageInfo[]> {
    signal?.throwIfAborted()
    const onEvent: StreamOutdatedPackagesCallback = (event) => {
      signal?.throwIfAborted()
      callback(event)
    }
    if (!this.packageJson) {
      throw new Error('No package.json found in current directory')
    }

    const t0 = Date.now()
    debugLog.info('PackageDetector', `Starting scan in ${this.cwd}`)

    const prepared = await this.prepareDependencies(onEvent)
    const initialPayload: StreamOutdatedPackagesInitialPayload = {
      allDependencies: prepared.allDependencies,
      uniquePackages: prepared.uniquePackages,
      currentVersions: prepared.currentVersions,
      progress: this.createProgressSnapshot('resolving', { total: prepared.uniquePackages.length }),
    }

    onEvent({ type: 'initial', payload: initialPayload })

    const packageLookup = new Map<string, PackageInfo[]>()
    let resolved = 0
    let failed = 0
    const performanceTracker = getPerformanceTracker()

    const tFetch = Date.now()
    debugLog.info('PackageDetector', 'fetching version data via npm registry')

    await fetchPackageVersions(prepared.uniquePackages, {
      signal,
      currentVersions: prepared.currentVersions,
      // Publish times live only in the full packument; fetch it only when the
      // release-age policy actually needs them.
      fullMetadata: this.minimumReleaseAge > 0,
      concurrency: this.concurrency,
      networkProfile: this.networkProfile,
      onNetworkProfile: (profile) => configManager.setNetworkProfile(profile),
      onControlTick: (tick) => {
        this.lastControlTick = tick
        performanceTracker.recordControlTick(tick)
      },
      onPackageTiming: (name, latencyMs) =>
        performanceTracker.recordPackageTiming({ name, latencyMs }),
      onPackageReady: ({ packageName, data }) => {
        // First-wins in the tracker; headless runs get the phase from here,
        // the interactive runner's own mark becomes a no-op duplicate.
        performanceTracker.mark('firstResult')
        const packageInfo = this.resolvePackageGroup(
          packageName,
          prepared.dependenciesByName.get(packageName) ?? [],
          data
        )
        packageLookup.set(packageName, packageInfo)
        resolved++

        if (data.latestVersion === 'unknown') {
          failed++
          performanceTracker.recordFailedPackage(packageName)
        }
        performanceTracker.recordCounts({ resolved, failed })

        onEvent({
          type: 'package',
          payload: {
            packageName,
            packageInfo,
            progress: this.createProgressSnapshot('resolving', {
              total: prepared.uniquePackages.length,
              resolved,
              failed,
            }),
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
    const progress = this.createProgressSnapshot('done', {
      total: prepared.uniquePackages.length,
      resolved,
      failed,
    })

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

    return finalPackages
  }

  private async prepareDependencies(
    onEvent: StreamOutdatedPackagesCallback
  ): Promise<PreparedDependencies> {
    const performanceTracker = getPerformanceTracker()

    onEvent({
      type: 'status',
      payload: { progress: this.createProgressSnapshot('discovering') },
    })
    const tScan = Date.now()
    const allPackageJsonFiles = await this.findPackageJsonFilesWithTimeout(30000, onEvent)
    debugLog.perf('PackageDetector', `file scan (${allPackageJsonFiles.length} files)`, tScan, {
      files: allPackageJsonFiles,
    })
    performanceTracker.recordPhaseDuration('discovery', Date.now() - tScan)
    performanceTracker.recordCounts({ packageJsonFiles: allPackageJsonFiles.length })
    onEvent({
      type: 'status',
      payload: {
        progress: this.createProgressSnapshot('collecting', {
          packageJsonFiles: allPackageJsonFiles.length,
        }),
      },
    })
    const tDeps = Date.now()
    const allDepsRaw = await collectAllDependenciesAsync(allPackageJsonFiles, {
      includePeerDeps: true,
      includeOptionalDeps: true,
    })
    debugLog.perf('PackageDetector', `dependency collection (${allDepsRaw.length} raw deps)`, tDeps)
    performanceTracker.recordPhaseDuration('depCollection', Date.now() - tDeps)
    performanceTracker.recordCounts({ rawDependencies: allDepsRaw.length })

    onEvent({
      type: 'status',
      payload: {
        progress: this.createProgressSnapshot('resolving', {
          packageJsonFiles: allPackageJsonFiles.length,
        }),
      },
    })
    const tFilter = Date.now()
    const allDependencies: DependencyEntry[] = []
    const dependenciesByName = new Map<string, DependencyEntry[]>()
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
      const group = dependenciesByName.get(dep.name)
      if (group) group.push(dep)
      else dependenciesByName.set(dep.name, [dep])
    }

    const uniquePackages = Array.from(dependenciesByName.keys()).sort((a, b) => {
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

    // First declaration wins, matching the order dependencies were collected.
    const currentVersions = new Map<string, string>()
    for (const [name, [first]] of dependenciesByName) {
      currentVersions.set(name, first.version)
    }

    return {
      allDependencies,
      dependenciesByName,
      uniquePackages,
      currentVersions,
    }
  }

  private resolvePackageGroup(
    packageName: string,
    dependencies: DependencyEntry[],
    packageData: PackageVersionData | undefined
  ): PackageInfo[] {
    this.recordCooldownSupport(packageData)
    if (!packageData || packageData.latestVersion === 'unknown') {
      debugLog.warn('PackageDetector', `no data returned for ${packageName} — marking unavailable`)
      return dependencies.map((dep) => this.createFailedPackageInfo(dep))
    }
    const { latestVersion } = packageData

    // Registry metadata and the ignore-major policy are shared by the whole
    // group, so the outcome depends only on the specifier: compute it once per
    // distinct specifier and re-stamp each declaration's own source fields.
    const resolvedBySpecifier = new Map<string, PackageInfo>()

    return dependencies.map((dep) => {
      const cached = resolvedBySpecifier.get(dep.version)
      if (cached) {
        return { ...cached, ...declarationFields(dep) }
      }
      try {
        const installed = parseCurrentVersion(dep.version)
        const currentIsPrerelease = (installed?.prerelease.length ?? 0) > 0

        // A stable install never upgrades onto the prerelease channel.
        // latestVersion is a prerelease only for prerelease-only packages
        // (zero stable publishes) — report those unavailable, exactly as
        // before prerelease support existed.
        if (!currentIsPrerelease && semver.prerelease(latestVersion) !== null) {
          return this.createFailedPackageInfo(dep)
        }

        // Versions still inside the release-age window are never offered, on
        // either channel, and the pools below are the gated ones.
        const { data: gated, held } = this.applyReleaseAgePolicy(dep, packageData, installed)
        const gatedStable = gated.allVersions
        const gatedPrereleases = gated.prereleaseVersions

        // Stable installs see the stable pool untouched; prerelease installs
        // also see prereleases on their own major.minor.patch tuple (npm range
        // semantics: ^1.0.0-beta.2 satisfies 1.0.0-rc.3).
        const candidateVersions = buildRangeCandidates(installed, gatedStable, gatedPrereleases)
        const closestMinorVersion = findClosestMinorVersion(dep.version, candidateVersions)
        // On the prerelease channel "latest" is the newest publish on any
        // channel — a beta user is told about the rc and about the final.
        const effectiveLatest = currentIsPrerelease
          ? (highestOverallVersion(gatedStable, gatedPrereleases) ?? gated.latestVersion)
          : gated.latestVersion

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
          debugLog.info(
            'PackageDetector',
            `outdated: ${dep.name} ${dep.version} → range:${closestMinorVersion ?? '-'} latest:${effectiveLatest}`
          )
        }

        const info: PackageInfo = {
          name: dep.name,
          currentVersion: dep.version,
          rangeVersion: closestMinorVersion || dep.version,
          latestVersion: effectiveLatest,
          ...declarationFields(dep),
          isOutdated,
          hasRangeUpdate,
          hasMajorUpdate,
          majorIgnored,
          allVersions: candidateVersions,
          // The cooldown drops these when it moves the latest: they describe the
          // true latest, and misattributing them to an older version is worse
          // than staying silent.
          deprecated: gated.deprecated,
          enginesNode: gated.enginesNode,
          heldByCooldown: held,
        }
        resolvedBySpecifier.set(dep.version, info)
        return info
      } catch (error) {
        debugLog.error('PackageDetector', `error processing ${dep.name}`, error)
        return this.createFailedPackageInfo(dep)
      }
    })
  }

  /**
   * Enforce the release-age cooldown (`minimumReleaseAge`, minutes): versions published more
   * recently than the window are treated as if they don't exist yet, so neither the TUI nor
   * --apply can pick them. Freshly published versions are the most likely to be a compromised
   * release nobody has caught yet.
   *
   * When the true latest is gated away, the health signals tied to it (deprecation, engines)
   * are dropped rather than misattributed to the older effective latest. If EVERY version is
   * too young (brand-new package), the installed version becomes the effective latest — the
   * package simply reports "nothing to upgrade to (yet)".
   */
  private applyReleaseAgePolicy(
    dep: DependencyEntry,
    packageData: PackageVersionData,
    installed: semver.SemVer | null
  ): { data: PackageVersionData; held?: CooldownHold } {
    if (this.minimumReleaseAge <= 0) return { data: packageData }
    if (
      this.minimumReleaseAgeExclude.length > 0 &&
      isPackageIgnored(dep.name, this.minimumReleaseAgeExclude)
    ) {
      return { data: packageData }
    }

    const { data, held, withheldTotal } = applyReleaseAgeCooldown(packageData, {
      minimumReleaseAgeMinutes: this.minimumReleaseAge,
      installed,
      specifier: dep.version,
    })
    if (withheldTotal === 0) return { data }

    // One line per (package, specifier), because `resolvePackageGroup` evaluates the policy
    // once per distinct specifier and re-stamps the rest: a monorepo declaring the same
    // dependency in five manifests describes one gate, not five.
    debugLog.info(
      'PackageDetector',
      `release-age gate: ${withheldTotal} version(s) of ${dep.name} younger than ${this.minimumReleaseAge}min withheld (effective latest: ${data.latestVersion})`
    )

    return { data, held }
  }

  /** Cooldown support probe: packages whose data arrived, and whether any carried `time`. */
  private cooldownPackagesResolved = 0
  private cooldownPublishTimesSeen = false

  /**
   * Note whether this packument actually carried publish times, so a cooldown that could
   * not act is never mistaken for a cooldown that found nothing to hold.
   *
   * The policy deliberately fails open on missing `time` data, which means a registry that
   * doesn't expose it produces an empty held list — identical to "every version is old
   * enough". That is the one reading a supply-chain control must never invite, so the
   * distinction is tracked here and reported by the callers.
   */
  private recordCooldownSupport(packageData: PackageVersionData | undefined): void {
    if (this.minimumReleaseAge <= 0) return
    if (!packageData || packageData.latestVersion === 'unknown') return
    this.cooldownPackagesResolved++
    if (packageData.publishTimes !== undefined) this.cooldownPublishTimesSeen = true
  }

  /**
   * What the release-age cooldown was able to do this run, or null when it was disabled.
   * `publishTimesAvailable: false` means the registry never returned a `time` field, so the
   * cooldown was inert regardless of the configured window.
   */
  public getCooldownDiagnostics(): {
    minimumReleaseAge: number
    publishTimesAvailable: boolean
  } | null {
    if (this.minimumReleaseAge <= 0) return null
    return {
      minimumReleaseAge: this.minimumReleaseAge,
      // No packages resolved at all (empty project, total fetch failure) is not evidence
      // the registry lacks publish times, so it is not reported as unsupported.
      publishTimesAvailable: this.cooldownPackagesResolved === 0 || this.cooldownPublishTimesSeen,
    }
  }

  private createFailedPackageInfo(dep: DependencyEntry): PackageInfo {
    return {
      name: dep.name,
      currentVersion: dep.version,
      rangeVersion: 'unknown',
      latestVersion: 'unknown',
      ...declarationFields(dep),
      isOutdated: false,
      hasRangeUpdate: false,
      hasMajorUpdate: false,
    }
  }

  private createProgressSnapshot(
    phase: PackageLoadProgress['phase'],
    {
      total = 0,
      resolved = 0,
      failed = 0,
      packageJsonFiles,
      scanningDir,
    }: Partial<
      Pick<
        PackageLoadProgress,
        'total' | 'resolved' | 'failed' | 'packageJsonFiles' | 'scanningDir'
      >
    > = {}
  ): PackageLoadProgress {
    return {
      phase,
      discovered: total,
      resolved,
      total,
      failed,
      isLoading: phase !== 'done',
      slowNetwork: this.isSlowNetwork(),
      packageJsonFiles,
      scanningDir,
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

  private async findPackageJsonFilesWithTimeout(
    timeoutMs: number,
    onEvent: StreamOutdatedPackagesCallback
  ): Promise<string[]> {
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
              onEvent({
                type: 'status',
                payload: {
                  progress: this.createProgressSnapshot('discovering', {
                    packageJsonFiles: foundCount,
                    scanningDir: currentDir,
                  }),
                },
              })
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
        this.warnSkippedPackageDirs(skippedPackageDirs, onEvent)
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
  private warnSkippedPackageDirs(
    skippedPackageDirs: Set<string>,
    onEvent: StreamOutdatedPackagesCallback
  ): void {
    if (skippedPackageDirs.size === 0) {
      return
    }
    const list = Array.from(skippedPackageDirs).sort()
    onEvent({
      type: 'warning',
      payload: {
        message:
          `⚠️  Skipped ${list.length} package.json-bearing director${
            list.length === 1 ? 'y' : 'ies'
          } matching the default ignore list:\n` +
          list.map((dir) => `   - ${dir}`).join('\n') +
          `\n   Add the directory name(s) to "scanDirs" in .inuprc to include them.`,
      },
    })
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

  public getOutdatedPackagesOnly(packages: PackageInfo[]): PackageInfo[] {
    return packages.filter((pkg) => pkg.isOutdated)
  }
}
