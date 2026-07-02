import * as semver from 'semver'

/**
 * Check whether the running Node version satisfies a package's declared
 * `engines.node` range. Returns a short human-readable warning when it does
 * not, or `null` when compatible (or when the inputs are unusable).
 *
 * Best-effort: an unparseable range is treated as "no opinion" (null) rather
 * than a false warning.
 */
export function checkNodeEngineCompatibility(
  requiredRange: string | undefined,
  currentNodeVersion: string = process.versions.node
): string | null {
  if (!requiredRange) {
    return null
  }

  const range = semver.validRange(requiredRange, { loose: true })
  if (!range) {
    return null
  }

  const current = semver.coerce(currentNodeVersion)
  if (!current) {
    return null
  }

  if (semver.satisfies(current, range, { includePrerelease: true })) {
    return null
  }

  return `requires Node ${requiredRange}, you're on ${current.version}`
}
