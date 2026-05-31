import chalk from 'chalk'

export interface ColorEnv {
  NO_COLOR?: string
  FORCE_COLOR?: string
}

/**
 * Decide whether colored output should be disabled.
 *
 * Precedence (highest first):
 *   1. An explicit `--no-color` flag (`colorFlag === false`) always wins.
 *   2. `FORCE_COLOR` keeps colors on.
 *   3. `NO_COLOR` (any non-empty value) disables them — the de-facto standard.
 *
 * chalk v5 already honors the env vars on its own, but the explicit flag does
 * not flow through automatically, so we resolve the final intent here.
 */
export function shouldDisableColor(
  colorFlag: boolean | undefined,
  env: ColorEnv = process.env
): boolean {
  if (colorFlag === false) {
    return true
  }
  if (env.FORCE_COLOR) {
    return false
  }
  return Boolean(env.NO_COLOR)
}

/**
 * Apply the resolved color intent to chalk's global level. Call once at startup
 * before anything renders.
 */
export function applyColorSetting(
  colorFlag: boolean | undefined,
  env: ColorEnv = process.env
): void {
  if (shouldDisableColor(colorFlag, env)) {
    chalk.level = 0
  }
}
