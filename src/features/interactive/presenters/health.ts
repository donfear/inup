import { checkNodeEngineCompatibility } from '../../../shared/engines'
import type { PackageSelectionState } from '../../../shared/types'
import { getThemeColor } from '../themes-colors'

export type HealthState = Pick<
  PackageSelectionState,
  'deprecated' | 'enginesNode' | 'heldByCooldown'
>

/**
 * A compact badge flagging a package's health in the list:
 *   - `[DEPR]` when the latest version is deprecated (highest priority),
 *   - `[ENG]`  when its `engines.node` is incompatible with the running Node, or
 *   - `[HELD]` when the release-age cooldown withheld a newer version.
 *
 * Returns an empty string when none applies. Deprecation wins because an
 * engines mismatch on an abandoned package is moot; the cooldown ranks last
 * because it reports a deliberate, benign choice rather than a problem.
 * All render in the theme's (amber) warning color — caution, not alarm.
 */
export function getHealthBadge(state: HealthState): string {
  if (state.deprecated) {
    return getThemeColor('warning')('[DEPR]')
  }
  if (checkNodeEngineCompatibility(state.enginesNode)) {
    return getThemeColor('warning')('[ENG]')
  }
  if (state.heldByCooldown) {
    return getThemeColor('warning')('[HELD]')
  }
  return ''
}
