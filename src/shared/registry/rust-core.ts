import { createRequire } from 'node:module'
import { join } from 'node:path'
import { debugLog } from '../debug-logger'
import type { ParsedVersions } from '../versions'

/**
 * Rust implementation of the registry hot path (decompress, parse, write the
 * ETag cache entry), shipped as prebuilt Node-API addons in the optional
 * `inup-<abi>` packages. See native/README.md.
 *
 * Resolution, once per process: the installed platform package, then a local
 * `pnpm native:build` output (source checkouts), then the TypeScript path.
 * Nothing here throws: a missing, foreign or incompatible addon only leaves a
 * debug-log warning. INUP_CORE=js forces TypeScript (development only).
 */

/** Must equal inup_core::ABI_VERSION in native/core/src/lib.rs. */
export const CORE_ABI_VERSION = 1

export type CoreName = 'native' | 'js'

export interface PackumentDecodeRequest {
  raw: Buffer
  /** Lower-cased content-encoding; '' when absent. */
  encoding: string
  /** Where to persist the ETag cache entry, or null to skip it. */
  cache: { file: string; etag: string } | null
}

export type PackumentDecoder = (request: PackumentDecodeRequest) => Promise<ParsedVersions>

export interface HostInfo {
  platform: NodeJS.Platform
  arch: string
  /** Linux only: true on musl (Alpine), false on glibc. */
  isMusl: boolean
}

/** Result shape of the addon; Rust `None` arrives as null. */
interface RawParsed {
  latestVersion: string
  allVersions: string[]
  prereleaseVersions: string[]
  deprecated?: string | null
  enginesNode?: string | null
}

interface NativeModule {
  abiVersion(): number
  /** Runs on the libuv thread pool; writes the cache entry when given a file. */
  decodePackument(
    raw: Buffer,
    encoding: string,
    cacheFile: string | null,
    etag: string | null
  ): Promise<RawParsed>
}

const ABIS: Partial<Record<NodeJS.Platform, Partial<Record<string, string>>>> = {
  darwin: { arm64: 'darwin-arm64', x64: 'darwin-x64' },
  win32: { arm64: 'win32-arm64-msvc', x64: 'win32-x64-msvc' },
  linux: { arm64: 'linux-arm64', x64: 'linux-x64' },
}

/**
 * The napi-rs platform suffix of the prebuilt addon for a host (the package is
 * `inup-<abi>`), or null when none is published for it.
 */
export function nativeAbi({ platform, arch, isMusl }: HostInfo): string | null {
  const abi = ABIS[platform]?.[arch]
  if (!abi) return null
  return platform === 'linux' ? `${abi}-${isMusl ? 'musl' : 'gnu'}` : abi
}

/** Diagnostic report of the running process, for Linux libc detection. */
function processReport(): unknown {
  // excludeNetwork skips the report's network section, which can do slow
  // reverse DNS lookups (Node >= 22.13; not yet in the bundled @types/node).
  const report = process.report as NodeJS.ProcessReport & { excludeNetwork?: boolean }
  report.excludeNetwork = true
  return report.getReport()
}

export function detectHost({
  platform = process.platform,
  arch = process.arch,
  getReport = processReport,
}: {
  platform?: NodeJS.Platform
  arch?: string
  getReport?: () => unknown
} = {}): HostInfo {
  let isMusl = false
  if (platform === 'linux') {
    const report = getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
    isMusl = !report?.header?.glibcVersionRuntime
  }
  return { platform, arch, isMusl }
}

const DEV_BUILD_DIR = join(__dirname, '..', '..', '..', 'native', 'out')
const nodeRequire = createRequire(__filename)

interface Environment {
  host: () => HostInfo
  load: (id: string) => unknown
}

const defaultEnvironment = (): Environment => ({ host: () => detectHost(), load: nodeRequire })

let environment = defaultEnvironment()
let resolved: { core: CoreName; decoder: PackumentDecoder | null } | null = null

/** Test hook: override host detection and module loading (null restores both). */
export function setRustCoreEnvironment(
  env: { host?: HostInfo; load?: (id: string) => unknown } | null
): void {
  const defaults = defaultEnvironment()
  const host = env?.host
  environment = {
    host: host ? () => host : defaults.host,
    load: env?.load ?? defaults.load,
  }
  resolved = null
}

/** The Rust decoder, or null when this process uses the TypeScript path. */
export function packumentDecoder(): PackumentDecoder | null {
  return resolve().decoder
}

/** Which implementation decodes registry responses in this process. */
export function activeCore(): CoreName {
  return resolve().core
}

function resolve(): { core: CoreName; decoder: PackumentDecoder | null } {
  if (!resolved) {
    resolved = process.env.INUP_CORE === 'js' ? { core: 'js', decoder: null } : loadNative()
    debugLog.info('rust-core', `registry decoder: ${resolved.core}`)
  }
  return resolved
}

function loadNative(): { core: CoreName; decoder: PackumentDecoder | null } {
  const abi = nativeAbi(environment.host())
  if (!abi) return { core: 'js', decoder: null }

  const failures: string[] = []
  for (const id of [`inup-${abi}`, join(DEV_BUILD_DIR, `inup.${abi}.node`)]) {
    try {
      const mod = environment.load(id) as Partial<NativeModule> | null
      if (typeof mod?.abiVersion !== 'function' || mod.abiVersion() !== CORE_ABI_VERSION) {
        failures.push(`${id}: incompatible addon (expected ABI ${CORE_ABI_VERSION})`)
      } else if (typeof mod.decodePackument !== 'function') {
        failures.push(`${id}: missing decodePackument`)
      } else {
        return { core: 'native', decoder: nativeDecoder(mod as NativeModule) }
      }
    } catch (error) {
      failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  debugLog.warn('rust-core', `no usable native core for ${abi}, using TypeScript`, failures)
  return { core: 'js', decoder: null }
}

function nativeDecoder(mod: NativeModule): PackumentDecoder {
  return async ({ raw, encoding, cache }) =>
    toParsedVersions(
      await mod.decodePackument(raw, encoding, cache?.file ?? null, cache?.etag ?? null)
    )
}

/** Same keys, in the same order, as parseVersions returns. */
function toParsedVersions(parsed: RawParsed): ParsedVersions {
  return {
    latestVersion: parsed.latestVersion,
    allVersions: parsed.allVersions,
    prereleaseVersions: parsed.prereleaseVersions,
    deprecated: parsed.deprecated ?? undefined,
    enginesNode: parsed.enginesNode ?? undefined,
  }
}
