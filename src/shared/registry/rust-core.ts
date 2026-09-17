import { createRequire } from 'node:module'
import { join } from 'node:path'
import envPaths from 'env-paths'
import { PACKAGE_NAME, PACKAGE_VERSION } from '../config'
import { debugLog } from '../debug-logger'
import type { ParsedVersions } from '../versions'
import { downloadNativeCore, nativeCoreFile } from './native-download'

/**
 * Optional Rust implementation of the registry hot path, prebuilt per platform
 * as the `inup-<abi>` npm packages. See native/README.md.
 *
 * Off unless the user opts in (`--native` or `"native": true` in .inuprc), and
 * nothing native is downloaded until then. When on, resolution happens once
 * per process:
 * 1. a local `pnpm native:build` output (source checkouts)
 * 2. the addon cached by an earlier opt-in run
 * 3. neither: this run uses TypeScript while the addon for this platform is
 *    downloaded (verified against the registry's sha512) for the next run
 *
 * Two capabilities, each optional in an addon:
 * - transport: a whole registry attempt off the JS thread — `nativeTransport()`
 * - decoder: decode a body the TypeScript transport fetched — `packumentDecoder()`
 *
 * Nothing here throws: a missing, foreign or incompatible addon, or a failed
 * download, only leaves a debug-log warning.
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
export interface RawParsed {
  latestVersion: string
  allVersions: string[]
  prereleaseVersions: string[]
  deprecated?: string | null
  enginesNode?: string | null
}

/** One native registry attempt, as `fetchPackument` reports it. */
export interface NativeFetchOutcome {
  kind: 'success' | 'not-found' | 'retryable' | 'congested' | 'transient' | 'cancelled' | 'fallback'
  /** success only: `ParsedVersions` as JSON text. */
  dataJson?: string | null
  revalidated: boolean
  /** Compressed body bytes of a 200. */
  bytes: number
  latencyMs: number
  status: number
  retryAfter?: string | null
  /** transient / fallback only: tls | connect | timeout | io | decode | internal */
  errorClass?: string | null
  error?: string | null
}

export interface NativeFetchRequest {
  url: string
  authorization?: string
  /** ETag cache entry to revalidate against and write; null skips the cache. */
  cacheFile: string | null
  /** Overrides the 30 s headers timeout (tests). */
  headersTimeoutMs?: number
}

export interface NativeTransport {
  fetch(request: NativeFetchRequest, signal?: AbortSignal): Promise<NativeFetchOutcome>
  /** Body bytes received since the last call, for the concurrency controller. */
  takeReceivedBytes(): number
}

interface NativeModule {
  abiVersion(): number
  /** Absent fields map to Rust `None`; napi rejects explicit nulls. */
  fetchPackument?(request: {
    url: string
    requestId: number
    authorization?: string
    cacheFile?: string
    headersTimeoutMs?: number
  }): Promise<NativeFetchOutcome>
  cancelFetch?(requestId: number): void
  takeReceivedBytes?(): number
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
  cacheRoot: () => string
  version: string
  download: typeof downloadNativeCore
}

const defaultEnvironment = (): Environment => ({
  host: () => detectHost(),
  load: nodeRequire,
  cacheRoot: () => envPaths(PACKAGE_NAME).cache,
  version: PACKAGE_VERSION,
  download: downloadNativeCore,
})

interface Resolved {
  core: CoreName
  decoder: PackumentDecoder | null
  transport: NativeTransport | null
}

const JS_ONLY: Resolved = { core: 'js', decoder: null, transport: null }

let environment = defaultEnvironment()
let enabled = false
let resolved: Resolved | null = null
let download: Promise<void> | null = null

/** Opt in to (or out of) the native core for this process. */
export function configureNativeCore(options: { enabled: boolean }): void {
  enabled = options.enabled
  resolved = null
}

/** Test hook: override host, loading, cache location, version and download. */
export function setRustCoreEnvironment(
  env:
    | (Partial<Omit<Environment, 'host' | 'cacheRoot'>> & {
        host?: HostInfo
        cacheRoot?: string
      })
    | null
): void {
  const defaults = defaultEnvironment()
  const host = env?.host
  const cacheRoot = env?.cacheRoot
  environment = {
    host: host ? () => host : defaults.host,
    load: env?.load ?? defaults.load,
    cacheRoot: cacheRoot ? () => cacheRoot : defaults.cacheRoot,
    version: env?.version ?? defaults.version,
    download: env?.download ?? defaults.download,
  }
  resolved = null
  download = null
}

/** The download started by this process, if any (settles, never rejects). */
export function nativeCoreDownload(): Promise<void> | null {
  return download
}

/** The Rust decoder, or null when this process uses the TypeScript path. */
export function packumentDecoder(): PackumentDecoder | null {
  return resolve().decoder
}

/** The native registry transport, or null when requests go through the JS transport. */
export function nativeTransport(): NativeTransport | null {
  return resolve().transport
}

/** Which implementation handles registry responses in this process. */
export function activeCore(): CoreName {
  return resolve().core
}

function resolve(): Resolved {
  if (!resolved) {
    resolved = enabled ? loadNative() : JS_ONLY
    const transport = resolved.transport ? 'native' : 'js'
    debugLog.info(
      'rust-core',
      `native core ${enabled ? 'enabled' : 'off'}; registry decoder: ${resolved.core}, transport: ${transport}`
    )
  }
  return resolved
}

function loadNative(): Resolved {
  const abi = nativeAbi(environment.host())
  if (!abi) {
    debugLog.warn('rust-core', `no prebuilt native core for ${process.platform}/${process.arch}`)
    return JS_ONLY
  }

  const cached = nativeCoreFile(environment.cacheRoot(), environment.version, abi)
  const failures: string[] = []
  for (const id of [join(DEV_BUILD_DIR, `inup.${abi}.node`), cached]) {
    try {
      const mod = environment.load(id) as Partial<NativeModule> | null
      if (typeof mod?.abiVersion !== 'function' || mod.abiVersion() !== CORE_ABI_VERSION) {
        failures.push(`${id}: incompatible addon (expected ABI ${CORE_ABI_VERSION})`)
      } else if (typeof mod.decodePackument !== 'function') {
        failures.push(`${id}: missing decodePackument`)
      } else {
        const native = mod as NativeModule
        return {
          core: 'native',
          decoder: nativeDecoder(native),
          transport: transportOf(native),
        }
      }
    } catch (error) {
      failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  debugLog.info('rust-core', `native core not available yet for ${abi}`, failures)
  startDownload(abi)
  return JS_ONLY
}

/** Fetch the addon in the background; this run stays on TypeScript. */
function startDownload(abi: string): void {
  if (download) return
  const { cacheRoot, version } = environment
  download = environment
    .download({ cacheRoot: cacheRoot(), version, abi })
    .then((file) => {
      debugLog.info('rust-core', `native core downloaded to ${file}; used from the next run`)
    })
    .catch((error: unknown) => {
      debugLog.warn('rust-core', `native core download failed, staying on TypeScript`, error)
    })
}

let nextRequestId = 1

/** Request ids stay in 1..2^32-2: the addon stores them as u32. */
export function followingRequestId(id: number): number {
  return id >= 0xffff_fffe ? 1 : id + 1
}

/** The transport, when the addon exports all of it (decode-only builds do not). */
function transportOf(mod: NativeModule): NativeTransport | null {
  const { fetchPackument, cancelFetch, takeReceivedBytes } = mod
  if (
    typeof fetchPackument !== 'function' ||
    typeof cancelFetch !== 'function' ||
    typeof takeReceivedBytes !== 'function'
  ) {
    return null
  }
  return {
    takeReceivedBytes: () => takeReceivedBytes.call(mod),
    fetch: async (request, signal) => {
      const requestId = nextRequestId
      nextRequestId = followingRequestId(nextRequestId)
      // napi maps absent object fields to Rust `None`, but rejects explicit
      // nulls: send only the fields that have a value.
      const { url, authorization, cacheFile, headersTimeoutMs } = request
      const pending = fetchPackument.call(mod, {
        url,
        requestId,
        ...(authorization ? { authorization } : {}),
        ...(cacheFile ? { cacheFile } : {}),
        ...(headersTimeoutMs ? { headersTimeoutMs } : {}),
      })
      if (!signal) return pending
      const cancel = () => cancelFetch.call(mod, requestId)
      if (signal.aborted) cancel()
      else signal.addEventListener('abort', cancel, { once: true })
      try {
        return await pending
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    },
  }
}

function nativeDecoder(mod: NativeModule): PackumentDecoder {
  return async ({ raw, encoding, cache }) =>
    toParsedVersions(
      await mod.decodePackument(raw, encoding, cache?.file ?? null, cache?.etag ?? null)
    )
}

/** Same keys, in the same order, as parseVersions returns. */
export function toParsedVersions(parsed: RawParsed): ParsedVersions {
  return {
    latestVersion: parsed.latestVersion,
    allVersions: parsed.allVersions,
    prereleaseVersions: parsed.prereleaseVersions,
    deprecated: parsed.deprecated ?? undefined,
    enginesNode: parsed.enginesNode ?? undefined,
  }
}
