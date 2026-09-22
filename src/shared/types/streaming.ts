import type { ParsedVersions } from '../versions'
import type { DependencyEntry, NetworkProfile, PackageInfo } from './domain'

export interface PackageLoadProgress {
  phase: 'discovering' | 'collecting' | 'resolving' | 'done'
  discovered: number
  resolved: number
  total: number
  failed: number
  isLoading: boolean
  /** The concurrency controller settled low / latency is high: tell the user
   * the wait is the connection, not a hang. */
  slowNetwork?: boolean
  packageJsonFiles?: number
  scanningDir?: string
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

/** One resolved package: every declaration of it across the workspace. */
export interface StreamedPackage {
  packageName: string
  packageInfo: PackageInfo[]
}

export type StreamOutdatedPackagesEvent =
  | { type: 'warning'; payload: { message: string } }
  | { type: 'status'; payload: { progress: PackageLoadProgress } }
  | { type: 'initial'; payload: StreamOutdatedPackagesInitialPayload }
  | { type: 'package'; payload: StreamedPackage & { progress: PackageLoadProgress } }
  | { type: 'complete'; payload: { packages: PackageInfo[]; progress: PackageLoadProgress } }

export type StreamOutdatedPackagesCallback = (event: StreamOutdatedPackagesEvent) => void

export interface FetchPackageVersionsOptions {
  /** Cancels queued requests, active downloads, and retry waits for this run. */
  signal?: AbortSignal
  /**
   * Pin registry-fetch concurrency to exactly this value and disable all
   * adaptation (and profile learning). The user-facing escape hatch.
   */
  concurrency?: number
  /**
   * Persisted starting hypothesis for the hill-climb controller. Validated
   * against live latency at run start — never a hard cap. Also caps the fixed
   * start of runs too small to control.
   */
  networkProfile?: NetworkProfile | null
  /**
   * Fires once at end of run with the settled profile worth persisting
   * (pinned runs and runs too small to control never learn).
   */
  onNetworkProfile?: (profile: NetworkProfile) => void
}

export interface RegistryPackageResult {
  packageName: string
  data: ParsedVersions
}

/** Fires once per package the moment it resolves; completion order, not request order. */
export type OnPackageReadyCallback = (result: RegistryPackageResult) => void
