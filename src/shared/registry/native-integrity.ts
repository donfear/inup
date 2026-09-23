/**
 * sha512 (SRI form) of the native core file `inup.<abi>.node` released with
 * this inup, per napi-rs platform suffix.
 *
 * Empty in the repository: the release workflow regenerates this file from
 * the exact addons it publishes (scripts/publish-native.mjs) before building
 * inup, so an installed inup downloads and loads only the addons released
 * with it, whichever registry serves them. A platform without an entry never
 * downloads or loads a cached addon; a local `pnpm native:build` is still used.
 */
export const NATIVE_INTEGRITY: Readonly<Partial<Record<string, string>>> = {}
