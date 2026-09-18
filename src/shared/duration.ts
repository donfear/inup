/**
 * Coarse human age for a timestamp: minutes under an hour, then hours, then days.
 *
 * Deliberately low-resolution. These read as "how stale is this", not as a measurement —
 * "3d" answers the question a release-age cooldown raises; "3d 4h 12m" only adds noise.
 *
 * Shared rather than per-feature so the picker, the plain report and the JSON consumers all
 * describe the same hold with the same words. (`action/render-pr-body.mjs` keeps its own copy
 * on purpose: it runs as bare Node in the GitHub Action with no build step and no imports.)
 */
export function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / (60 * 24))}d`
}
