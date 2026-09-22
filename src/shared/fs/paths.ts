import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PackageManagerDetector } from '../package-manager'
import type { PackageManager } from '../types'

export function findPackageJson(cwd: string = process.cwd()): string | null {
  const packageJsonPath = join(cwd, 'package.json')
  return existsSync(packageJsonPath) ? packageJsonPath : null
}

export function findWorkspaceRoot(cwd: string, packageManager: PackageManager): string | null {
  return PackageManagerDetector.findWorkspaceRoot(cwd, packageManager)
}
