import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import { type HttpResponse, httpRequest } from '../http/http-request'
import { registryTargetFor } from './registry-config'

/**
 * On-demand install of the prebuilt native core, used only after the user
 * opts in (`--native` or `"native": true` in .inuprc). Nothing native is part
 * of inup's own npm install.
 *
 * The addon for this platform is the `inup-<abi>` package at inup's own
 * version. It is fetched from the configured npm registry, verified against
 * the registry's published sha512 integrity (the same check npm install
 * performs), and extracted into the user cache so later runs load it directly.
 */

const gunzipAsync = promisify(gunzip)

const TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 3
/** A platform package is ~1.5 MB; anything far larger is not ours. */
const MAX_TARBALL_BYTES = 64 * 1024 * 1024

export class NativeDownloadError extends Error {
  override readonly name = 'NativeDownloadError'
}

/** Where the addon for `version`/`abi` is cached. */
export function nativeCoreFile(cacheRoot: string, version: string, abi: string): string {
  return join(cacheRoot, 'native', version, `inup.${abi}.node`)
}

async function readAll(response: HttpResponse): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > MAX_TARBALL_BYTES) {
      throw new NativeDownloadError('download exceeds the size limit')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function get(
  url: URL,
  headers: Record<string, string>,
  redirects = 0
): Promise<HttpResponse> {
  const response = await httpRequest(url.origin, {
    path: `${url.pathname}${url.search}`,
    headers,
    headersTimeoutMs: TIMEOUT_MS,
  })
  const location = response.headers.location
  if (response.statusCode >= 300 && response.statusCode < 400 && location) {
    await response.body.dump()
    if (redirects >= MAX_REDIRECTS) throw new NativeDownloadError('too many redirects')
    const next = new URL(location, url)
    // Credentials never follow a redirect to another origin.
    const nextHeaders =
      next.origin === url.origin
        ? headers
        : Object.fromEntries(Object.entries(headers).filter(([key]) => key !== 'authorization'))
    return get(next, nextHeaders, redirects + 1)
  }
  if (response.statusCode !== 200) {
    await response.body.dump()
    throw new NativeDownloadError(`GET ${url.href} returned ${response.statusCode}`)
  }
  return response
}

/** The tarball URL and integrity npm publishes for `name@version`. */
async function resolveTarball(name: string, version: string) {
  const target = registryTargetFor(name)
  const headers: Record<string, string> = { accept: 'application/vnd.npm.install-v1+json' }
  if (target.authHeader) headers.authorization = target.authHeader
  const packumentUrl = new URL(`${target.origin}${target.pathPrefix}/${name}`)
  const packument = JSON.parse((await readAll(await get(packumentUrl, headers))).toString('utf8'))
  const dist = packument?.versions?.[version]?.dist
  if (typeof dist?.tarball !== 'string' || typeof dist?.integrity !== 'string') {
    throw new NativeDownloadError(`${name}@${version} is not published`)
  }
  const tarball = new URL(dist.tarball)
  return {
    tarball,
    integrity: dist.integrity as string,
    // npm sends registry credentials only to the registry's own origin.
    headers:
      tarball.origin === target.origin && target.authHeader
        ? { authorization: target.authHeader }
        : ({} as Record<string, string>),
  }
}

/** Throws unless `data` matches a sha512 entry of the SRI string. */
export function verifyIntegrity(data: Buffer, integrity: string): void {
  const expected = integrity
    .split(/\s+/)
    .filter((entry) => entry.startsWith('sha512-'))
    .map((entry) => entry.slice('sha512-'.length).split('?')[0])
  if (expected.length === 0) {
    throw new NativeDownloadError('no sha512 integrity published')
  }
  const actual = createHash('sha512').update(data).digest('base64')
  if (!expected.includes(actual)) {
    throw new NativeDownloadError('integrity check failed')
  }
}

/** The content of `path` inside an (uncompressed) tar archive, or null. */
export function extractTarEntry(tar: Buffer, path: string): Buffer | null {
  const text = (start: number, length: number) =>
    tar.toString('utf8', start, start + length).replace(/\0.*$/s, '')
  let offset = 0
  while (offset + 512 <= tar.length) {
    const name = text(offset, 100)
    if (name === '') return null // end-of-archive marker
    const prefix = text(offset + 345, 155)
    const size = Number.parseInt(text(offset + 124, 12).trim() || '0', 8)
    const type = text(offset + 156, 1)
    const fullName = prefix ? `${prefix}/${name}` : name
    const start = offset + 512
    if ((type === '0' || type === '') && fullName === path) {
      return tar.subarray(start, start + size)
    }
    offset = start + Math.ceil(size / 512) * 512
  }
  return null
}

/**
 * Download, verify and cache the addon for this platform. Old versions in the
 * cache are removed once the new one is in place.
 */
export async function downloadNativeCore(options: {
  cacheRoot: string
  version: string
  abi: string
}): Promise<string> {
  const name = `inup-${options.abi}`
  const { tarball, integrity, headers } = await resolveTarball(name, options.version)
  const archive = await readAll(await get(tarball, headers))
  verifyIntegrity(archive, integrity)
  const addon = extractTarEntry(await gunzipAsync(archive), `package/inup.${options.abi}.node`)
  if (!addon) {
    throw new NativeDownloadError(`${name}@${options.version} has no inup.${options.abi}.node`)
  }

  const file = nativeCoreFile(options.cacheRoot, options.version, options.abi)
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, addon)
  renameSync(temp, file)

  const versionsDir = join(options.cacheRoot, 'native')
  for (const entry of readdirSync(versionsDir)) {
    if (entry !== options.version) {
      rmSync(join(versionsDir, entry), { recursive: true, force: true })
    }
  }
  return file
}
