export interface CIEnv {
  CI?: string
}

/**
 * Whether the `CI` environment variable marks this as a CI run. Set is not enough: Create React
 * App setups and some shell profiles export `CI=false` (or `CI=0`) to opt out, so those and an
 * empty value mean no, in any case.
 */
export function isCI(env: CIEnv = process.env): boolean {
  const value = env.CI?.trim().toLowerCase()
  return !!value && value !== 'false' && value !== '0'
}

/**
 * Whether someone is at the keyboard: stdin and stdout are both terminals and this is not a CI
 * run. The picker and the [y/N] prompts need all three — with stdin redirected
 * (`inup < /dev/null`) the picker would open, never receive a key, and exit once loading ended.
 */
export function isInteractiveTerminal(env: CIEnv = process.env): boolean {
  return !!process.stdin.isTTY && !!process.stdout.isTTY && !isCI(env)
}
