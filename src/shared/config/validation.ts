import { POOL_CONNECTIONS } from './constants'

// One definition of each accepted range, shared by the CLI flags and .inuprc so
// the two can never disagree about what a valid value is.

/** Pinned registry-fetch parallelism: an integer 1..POOL_CONNECTIONS. */
export function isValidConcurrency(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= POOL_CONNECTIONS
}

/** Release-age cooldown: a non-negative integer number of minutes (0 disables it). */
export function isValidMinimumReleaseAge(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}
