#!/usr/bin/env node
// Assemble and publish the per-platform native core packages for this inup
// version, from the addons the native-build workflow produced.
//
//   node scripts/publish-native.mjs --artifacts <dir> [--out <dir>] [--dry-run]
//
// - Refuses to publish anything unless every platform's addon is present.
// - Skips versions already on the registry, so a failed publish job can simply
//   be re-run.
// - Prereleases (1.8.0-rc.0) go to the `next` dist-tag, releases to `latest`.
// Needs `pnpm build` first: package names come from the built loader.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

/** napi-rs platform suffixes of every published addon. */
export const TARGET_ABIS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64-gnu',
  'linux-arm64-musl',
  'linux-x64-gnu',
  'linux-x64-musl',
  'win32-arm64-msvc',
  'win32-x64-msvc',
]

export function distTagFor(version) {
  return version.includes('-') ? 'next' : 'latest'
}

/** npm `os` / `cpu` / `libc` constraints for a platform suffix. */
export function platformOf(abi) {
  const [os, cpu, variant] = abi.split('-')
  const platform = { os: [os], cpu: [cpu] }
  if (variant === 'gnu') platform.libc = ['glibc']
  if (variant === 'musl') platform.libc = ['musl']
  return platform
}

export function platformManifest({ abi, version, name, repository }) {
  const file = `inup.${abi}.node`
  return {
    name,
    version,
    description: `inup's native core for ${abi}. Downloaded by \`inup --native\`; do not depend on it directly.`,
    license: 'MIT',
    repository,
    ...platformOf(abi),
    main: file,
    files: [file],
  }
}

/** Map each target to its addon file among `paths`; report the missing ones. */
export function findAddons(paths, abis = TARGET_ABIS) {
  const byName = new Map(paths.map((path) => [basename(path), path]))
  const found = new Map()
  const missing = []
  for (const abi of abis) {
    const path = byName.get(`inup.${abi}.node`)
    if (path) found.set(abi, path)
    else missing.push(abi)
  }
  return { found, missing }
}

function listFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}

function isPublished(name, version) {
  try {
    execFileSync('npm', ['view', `${name}@${version}`, 'version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      artifacts: { type: 'string' },
      out: { type: 'string', default: 'native/npm' },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  if (!values.artifacts) throw new Error('--artifacts <dir> is required')

  const root = JSON.parse(readFileSync('package.json', 'utf8'))
  const { nativePackageName } = await import(resolve('dist/shared/registry/native-download.js'))

  const { found, missing } = findAddons(listFiles(resolve(values.artifacts)))
  if (missing.length > 0) {
    throw new Error(`refusing to publish, addons missing for: ${missing.join(', ')}`)
  }

  const out = resolve(values.out)
  rmSync(out, { recursive: true, force: true })
  const tag = distTagFor(root.version)
  for (const [abi, addon] of found) {
    const name = nativePackageName(abi)
    const dir = join(out, abi)
    mkdirSync(dir, { recursive: true })
    copyFileSync(addon, join(dir, `inup.${abi}.node`))
    const manifest = platformManifest({ abi, version: root.version, name, repository: root.repository })
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

    if (!values['dry-run'] && isPublished(name, root.version)) {
      console.log(`skip ${name}@${root.version} (already published)`)
      continue
    }
    const args = ['publish', dir, '--access', 'public', '--tag', tag]
    if (values['dry-run']) args.push('--dry-run')
    else args.push('--provenance')
    console.log(`npm ${args.join(' ')}`)
    execFileSync('npm', args, { stdio: 'inherit' })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
