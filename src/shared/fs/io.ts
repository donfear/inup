import { promises as fsPromises, readFileSync } from 'node:fs'
import { debugLog } from '../debug-logger'
import type { PackageJson } from '../types'

const BOM = '\uFEFF'

/**
 * Drop a leading UTF-8 byte order mark. Some Windows editors save package.json with one; npm
 * and Node's own loader accept it, but JSON.parse rejects it as an unexpected token.
 */
export function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text
}

export function readPackageJson(path: string): PackageJson {
  try {
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(stripBom(content))
  } catch (error) {
    throw new Error(`Failed to read package.json: ${error}`)
  }
}

export interface JsonFormat {
  /** Indent passed to JSON.stringify — the original whitespace string (tabs or N spaces), or 2 as fallback. */
  indent: string | number
  /** Whether the original file ended with a trailing newline. */
  trailingNewline: boolean
  /** Line-ending style of the original file. CRLF files (common on Windows) must round-trip. */
  newline: '\n' | '\r\n'
  /** Whether the original file started with a UTF-8 byte order mark, which must round-trip too. */
  bom: boolean
}

/**
 * Detect the indentation, line-ending, and trailing-newline style of a raw JSON document so a
 * re-serialized version can preserve the original formatting instead of normalizing it.
 *
 * The first indented line's leading whitespace is exactly one indent unit; using it verbatim
 * as the JSON.stringify indent round-trips tabs, 2-space, and 4-space without branching on type.
 * Minified/single-line files (no indented line) fall back to 2 spaces, matching prior behavior.
 */
export function detectJsonFormat(raw: string): JsonFormat {
  const match = raw.match(/\n([ \t]+)\S/)
  return {
    indent: match ? match[1] : 2,
    trailingNewline: /\n$/.test(raw),
    newline: raw.includes('\r\n') ? '\r\n' : '\n',
    bom: raw.startsWith(BOM),
  }
}

/**
 * Serialize with JSON.stringify, then restore the document's original line-ending and
 * trailing-newline style. JSON.stringify only ever emits `\n`, so a CRLF package.json
 * would otherwise be silently rewritten to LF — pure diff churn for Windows users.
 */
export function stringifyWithFormat(value: unknown, format: JsonFormat): string {
  let content = JSON.stringify(value, null, format.indent)
  if (format.newline === '\r\n') {
    content = content.replace(/\n/g, '\r\n')
  }
  return (format.bom ? BOM : '') + content + (format.trailingNewline ? format.newline : '')
}

export async function readPackageJsonAsync(path: string): Promise<PackageJson> {
  try {
    const content = await fsPromises.readFile(path, 'utf-8')
    return JSON.parse(stripBom(content))
  } catch (error) {
    throw new Error(`Failed to read package.json: ${error}`)
  }
}

export async function collectAllDependenciesAsync(
  packageJsonFiles: string[]
): Promise<Array<{ name: string; version: string; type: string; packageJsonPath: string }>> {
  const packageJsonPromises = packageJsonFiles.map(async (packageJsonPath) => {
    try {
      const packageJson = await readPackageJsonAsync(packageJsonPath)
      return { packageJson, packageJsonPath }
    } catch {
      // Skip malformed package.json files
      return null
    }
  })

  const results = await Promise.all(packageJsonPromises)

  const allDeps: Array<{ name: string; version: string; type: string; packageJsonPath: string }> =
    []

  for (const result of results) {
    if (!result) continue

    const { packageJson, packageJsonPath } = result
    const depTypes: Array<
      'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies'
    > = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

    for (const depType of depTypes) {
      const deps = packageJson[depType]
      if (deps && typeof deps === 'object') {
        for (const [name, version] of Object.entries(deps)) {
          // `"foo": null` (or a number/object) is not a version range; one bad entry must not
          // take the whole scan down with it.
          if (typeof version !== 'string') {
            debugLog.warn(
              'DependencyCollector',
              `skipping ${depType}.${name} in ${packageJsonPath}: expected a version string, got ${JSON.stringify(version)}`
            )
            continue
          }
          allDeps.push({ name, version, type: depType, packageJsonPath })
        }
      }
    }
  }

  return allDeps
}
