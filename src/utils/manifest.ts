/**
 * Helpers for reading optional health signals out of an npm version manifest
 * (the per-version object inside an abbreviated packument, or a full version
 * document). Both fields are advisory and frequently absent.
 */

/**
 * npm represents deprecation as either a string message or the boolean `true`.
 * Normalize both into a displayable message, or `undefined` when not deprecated.
 */
export function normalizeDeprecatedMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  if (value === true) {
    return 'This version is deprecated.'
  }
  return undefined
}

/**
 * Extract the `engines.node` range from a manifest's `engines` object, if any.
 */
export function extractEnginesNode(engines: unknown): string | undefined {
  if (typeof engines === 'object' && engines !== null) {
    const node = (engines as { node?: unknown }).node
    if (typeof node === 'string' && node.trim()) {
      return node
    }
  }
  return undefined
}
