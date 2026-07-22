/**
 * Contract shared by the concurrency controllers (AIMD and hill-climb) and
 * everything that observes them (registry wiring, perf tracker, perf modal).
 * Pure types — no runtime code beyond what TypeScript erases.
 */

export type ControlTickReason =
  | 'up'
  | 'soft-down'
  | 'hard-down'
  | 'hold'
  // Emitted by the hill-climb controller only:
  | 'double'
  | 'revert'
  | 'step-down'
  | 'probe-up'
  | 'probe-reject'
  | 'regime-reset'

/** Hill-climb controller phase; AIMD has no phases and never sets it. */
export type ConcurrencyControllerState =
  | 'validating'
  | 'slow-start'
  | 'climb-up'
  | 'climb-down'
  | 'hold'

export interface ControlTick {
  atMs: number
  limit: number
  ewmaMs: number
  retries: number
  reason: ControlTickReason
  /** Window goodput (completions/sec); hill-climb controller only. */
  goodputRps?: number
  /** Controller phase after the decision; hill-climb controller only. */
  state?: ConcurrencyControllerState
  /** Share of ETag-304 revalidations in the window (0..1); hill-climb only. */
  revalidatedRatio?: number
}

export type RequestOutcomeKind = 'success' | 'congested' | 'retryable' | 'transient'

export interface RequestOutcomeMeta {
  /** True when the response was an ETag 304 revalidation (tiny and fast even on a slow pipe). */
  revalidated?: boolean
}

/**
 * A controller is a pure decision function fed per-request outcomes, returning
 * limit changes for the caller to apply to the resizable semaphore.
 */
export interface ConcurrencyController {
  getLimit(): number
  record(kind: RequestOutcomeKind, latencyMs?: number, meta?: RequestOutcomeMeta): number | null
  maybeTick(now?: number): number | null
  /** Stop making decisions (run tail); optional — AIMD does not need it. */
  freeze?(): void
}
