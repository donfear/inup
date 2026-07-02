import { readFileSync } from 'fs'
import { promises as fsPromises } from 'fs'
import { PackageJson } from '../types'

export interface CollectDependenciesOptions {
  includePeerDeps?: boolean
  includeOptionalDeps?: boolean
}

export function readPackageJson(path: string): PackageJson {
  try {
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    throw new Error(`Failed to read package.json: ${error}`)
  }
}

export interface JsonFormat {
  /** Indent passed to JSON.stringify — the original whitespace string (tabs or N spaces), or 2 as fallback. */
  indent: string | number
  /** Whether the original file ended with a trailing newline. */
  trailingNewline: boolean
}

/**
 * Detect the indentation and trailing-newline style of a raw JSON document so a
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
    trailingNewline: raw.endsWith('\n'),
  }
}

export async function readPackageJsonAsync(path: string): Promise<PackageJson> {
  try {
    const content = await fsPromises.readFile(path, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    throw new Error(`Failed to read package.json: ${error}`)
  }
}

export function collectAllDependencies(
  packageJsonFiles: string[],
  _options: CollectDependenciesOptions = {}
): Array<{ name: string; version: string; type: string; packageJsonPath: string }> {
  const allDeps: Array<{ name: string; version: string; type: string; packageJsonPath: string }> =
    []

  for (const packageJsonPath of packageJsonFiles) {
    try {
      const packageJson = readPackageJson(packageJsonPath)
      const depTypes: Array<
        'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies'
      > = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

      for (const depType of depTypes) {
        const deps = packageJson[depType]
        if (deps && typeof deps === 'object') {
          for (const [name, version] of Object.entries(deps)) {
            allDeps.push({
              name,
              version: version as string,
              type: depType,
              packageJsonPath,
            })
          }
        }
      }
    } catch {
      // Skip malformed package.json files
    }
  }

  return allDeps
}

export async function collectAllDependenciesAsync(
  packageJsonFiles: string[],
  _options: CollectDependenciesOptions = {}
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
          allDeps.push({
            name,
            version: version as string,
            type: depType,
            packageJsonPath,
          })
        }
      }
    }
  }

  return allDeps
}
