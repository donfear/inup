import getAuthToken from 'registry-auth-token'
import getRegistryUrlUntyped from 'registry-auth-token/registry-url'
import { NPM_REGISTRY_URL } from '../config'

// The submodule's .d.ts declares the second parameter as `{ npmrc?: … }`, but the
// implementation consumes the plain npmrc key/value record directly.
const getRegistryUrl = getRegistryUrlUntyped as unknown as (
  scope?: string,
  npmrc?: Record<string, string>
) => string

/**
 * Where to fetch a package's metadata from, resolved from the npm configuration
 * chain (project/workspace/user/global/builtin `.npmrc` files plus `npm_config_*`
 * environment variables) via `registry-auth-token`.
 *
 * Resolution is npm's own model: a package's scope selects the registry
 * (`@scope:registry`), falling back to the default `registry` key, falling back
 * to the public registry. Credentials are matched against that registry's URL
 * (`//host/path/:_authToken`, `:username`/`:_password`, legacy `:_auth`), with
 * `${ENV_VAR}` values expanded — so tokens are only ever sent to the registry
 * the npm config binds them to.
 */
export interface RegistryTarget {
  /** Origin the HTTP pool connects to, e.g. `https://registry.company.com`. */
  origin: string
  /** Registry URL path prefix ('' for npmjs; Artifactory-style registries nest under one). */
  pathPrefix: string
  /** `authorization` header value (`Bearer …` / `Basic …`) when credentials are configured. */
  authHeader?: string
}

/** npmrc key/value overrides; lets tests stay independent of the machine's real config. */
export type NpmrcOverride = Record<string, string>

/** Scope of a package name (`@scope/pkg` → `@scope`), or undefined when unscoped. */
export function scopeOfPackage(packageName: string): string | undefined {
  if (!packageName.startsWith('@')) return undefined
  const slash = packageName.indexOf('/')
  return slash > 0 ? packageName.slice(0, slash) : undefined
}

// Config files are re-read on every resolution inside registry-auth-token, so
// memoize per scope: one resolution per distinct scope per process.
const targetByScope = new Map<string, RegistryTarget>()

export function registryTargetFor(packageName: string, npmrc?: NpmrcOverride): RegistryTarget {
  const scope = scopeOfPackage(packageName) ?? ''
  if (!npmrc) {
    const cached = targetByScope.get(scope)
    if (cached) return cached
  }
  const target = resolveTarget(scope || undefined, npmrc)
  if (!npmrc) {
    targetByScope.set(scope, target)
  }
  return target
}

function resolveTarget(scope: string | undefined, npmrc?: NpmrcOverride): RegistryTarget {
  let registryHref = NPM_REGISTRY_URL
  try {
    registryHref = getRegistryUrl(scope, npmrc)
  } catch {
    // Unreadable npm config must never break a run — fall back to the public registry.
  }

  let parsed: URL
  try {
    parsed = new URL(registryHref)
  } catch {
    parsed = new URL(NPM_REGISTRY_URL)
  }

  let authHeader: string | undefined
  try {
    const auth = getAuthToken(parsed.href, { recursive: true, ...(npmrc ? { npmrc } : {}) })
    // registry-auth-token stringifies an unset ${ENV_VAR} reference into the
    // literal "undefined". Sending `Bearer undefined` guarantees a 401 where an
    // anonymous request might succeed, so treat it as no credentials.
    if (auth?.token && auth.token !== 'undefined') {
      authHeader = `${auth.type} ${auth.token}`
    }
  } catch {
    // No credentials (or unreadable config) → anonymous requests, matching npm.
  }

  return {
    origin: parsed.origin,
    pathPrefix: parsed.pathname.replace(/\/$/, ''),
    authHeader,
  }
}

/** Test helper: forget memoized resolutions so npmrc overrides take effect. */
export function clearRegistryTargetCache(): void {
  targetByScope.clear()
}
