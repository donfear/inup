import type { DependencyEntry, PackageInfo } from './domain'

export interface PackageLoadProgress {
  discovered: number
  resolved: number
  total: number
  failed: number
  isLoading: boolean
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
  ignoredDependencies: DependencyEntry[]
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
  /** Total in-flight registry fetches at any moment. Default: 10. */
  maxConcurrency?: number
  /** Size of each emission batch (UI grouping only, not concurrency). Default: 25. */
  batchSize?: number
  /** Sequence of batch sizes; overrides batchSize when provided. */
  batchSizes?: number[]
}

export interface RegistryBatchProgressItem {
  packageName: string
  data: { latestVersion: string; allVersions: string[] }
  completed: number
  total: number
  batchIndex: number
  itemIndex: number
}

export type OnBatchReadyCallback = (batch: RegistryBatchProgressItem[]) => void
