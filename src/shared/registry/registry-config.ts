import { resolve } from 'node:path'
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
// memoize per scope: one resolution per distinct scope per project.
const targetByScope = new Map<string, RegistryTarget>()

// The scanned project (`--dir`) whose `.npmrc` applies; unset means the working directory.
let projectDir: string | undefined

/** Resolve npm config for the project at `dir` from now on, not the working directory's. */
export function useNpmConfigFrom(dir: string): void {
  const resolved = resolve(dir)
  if (resolved === projectDir) return
  projectDir = resolved
  targetByScope.clear()
}

export function registryTargetFor(packageName: string, npmrc?: NpmrcOverride): RegistryTarget {
  const scope = scopeOfPackage(packageName) ?? ''
  if (!npmrc) {
    const cached = targetByScope.get(scope)
    if (cached) return cached
  }
  const target = inProjectDir(() => resolveTarget(scope || undefined, npmrc))
  if (!npmrc) {
    targetByScope.set(scope, target)
  }
  return target
}

/**
 * Runs a config load with `process.cwd()` reporting the scanned project.
 *
 * registry-auth-token loads npm config through @pnpm/npm-conf, which finds the
 * project `.npmrc` by walking up from `process.cwd()` and takes no directory to
 * start from (its `prefix` option would also move the global config to
 * `<prefix>/etc/npmrc`). inup does not chdir for `--dir`, so without this a scan
 * of another project would use the calling directory's registries and tokens.
 * The load is synchronous, so no other JavaScript sees the swap; a real
 * `process.chdir` would also move the directory under I/O running on other
 * threads, and throws in worker threads.
 */
function inProjectDir<T>(load: () => T): T {
  const dir = projectDir
  if (dir === undefined) return load()
  const cwd = process.cwd
  process.cwd = () => dir
  try {
    return load()
  } finally {
    process.cwd = cwd
  }
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

/** Test helper: forget the project directory and memoized resolutions. */
export function clearRegistryTargetCache(): void {
  projectDir = undefined
  targetByScope.clear()
}
