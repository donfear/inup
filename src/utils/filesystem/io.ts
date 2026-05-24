import { readFileSync } from 'fs'
import { promises as fsPromises } from 'fs'
import { PackageJson } from '../../types'

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
