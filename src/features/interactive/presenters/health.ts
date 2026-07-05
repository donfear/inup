import { checkNodeEngineCompatibility } from '../../../shared/engines'
import type { PackageSelectionState } from '../../../shared/types'
import { getThemeColor } from '../themes-colors'

export type HealthState = Pick<PackageSelectionState, 'deprecated' | 'enginesNode'>

/**
 * A compact badge flagging a package's health in the list:
 *   - `[DEPR]` when the latest version is deprecated (highest priority), or
 *   - `[ENG]`  when its `engines.node` is incompatible with the running Node.
 *
 * Returns an empty string when neither applies. Deprecation wins because an
 * engines mismatch on an abandoned package is moot. Both render in the theme's
 * (amber) warning color — a caution signal, not an alarm.
 */
export function getHealthBadge(state: HealthState): string {
  if (state.deprecated) {
    return getThemeColor('warning')('[DEPR]')
  }
  if (checkNodeEngineCompatibility(state.enginesNode)) {
    return getThemeColor('warning')('[ENG]')
  }
  return ''
}
