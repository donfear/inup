import type { ParsedVersions } from '../versions'
import type { DependencyEntry, NetworkProfile, PackageInfo } from './domain'

export interface PackageLoadProgress {
  discovered: number
  resolved: number
  total: number
  failed: number
  isLoading: boolean
  /** The concurrency controller settled low / latency is high: tell the user
   * the wait is the connection, not a hang. */
  slowNetwork?: boolean
}

export interface AuditProgress {
  completed: number
  total: number
  isRunning: boolean
  hasData: boolean
}

export interface StreamOutdatedPackagesInitialPayload {
  allDependencies: DependencyEntry[]
  uniquePackages: string[]
  currentVersions: Map<string, string>
  progress: PackageLoadProgress
}

export interface StreamOutdatedPackagesBatchItem {
  packageName: string
  packageInfo: PackageInfo[]
  failed: boolean
}

export type StreamOutdatedPackagesEvent =
  | { type: 'initial'; payload: StreamOutdatedPackagesInitialPayload }
  | {
      type: 'batch'
      payload: {
        batch: StreamOutdatedPackagesBatchItem[]
        progress: PackageLoadProgress
      }
    }
  | { type: 'complete'; payload: { packages: PackageInfo[]; progress: PackageLoadProgress } }

export type StreamOutdatedPackagesCallback = (event: StreamOutdatedPackagesEvent) => void

export interface FetchPackageVersionsOptions {
  /**
   * In-flight registry fetches at any moment. When `adaptive` is false this is
   * the fixed cap (the A/B control arm); when adaptive it is the legacy fallback
   * for runs too small to control. Default: 10.
   */
  maxConcurrency?: number
  /** Size of each emission batch (UI grouping only, not concurrency). Default: 25. */
  batchSize?: number
  /** Sequence of batch sizes; overrides batchSize when provided. */
  batchSizes?: number[]
  /**
   * Enable the adaptive-concurrency controller. Default: true. Set false to
   * pin concurrency at `maxConcurrency` (legacy fixed behavior / A/B baseline).
   */
  adaptive?: boolean
  /**
   * Pin registry-fetch concurrency to exactly this value and disable all
   * adaptation (and profile learning). The user-facing escape hatch.
   */
  concurrency?: number
  /**
   * Which adaptive controller drives the limit. Default: 'hillclimb'
   * (slow-start + goodput hill-climb, adapts down on slow links);
   * 'aimd' is the previous behavior, kept as the A/B control arm.
   */
  controllerMode?: 'aimd' | 'hillclimb'
  /**
   * Persisted starting hypothesis for the hill-climb controller. Validated
   * against live latency at run start — never a hard cap. Also caps the fixed
   * start of runs too small to control.
   */
  networkProfile?: NetworkProfile | null
  /**
   * Fires once at end of run with the settled profile worth persisting
   * (hill-climb controller only; pinned and fixed runs never learn).
   */
  onNetworkProfile?: (profile: NetworkProfile) => void
}

export interface RegistryBatchProgressItem {
  packageName: string
  data: ParsedVersions
  completed: number
  total: number
  batchIndex: number
  itemIndex: number
}

export type OnBatchReadyCallback = (batch: RegistryBatchProgressItem[]) => void
