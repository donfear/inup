import { existsSync } from 'fs'
import { join } from 'path'
import { PackageManager } from '../types'
import { PackageManagerDetector } from '../package-manager'

export function findPackageJson(cwd: string = process.cwd()): string | null {
  const packageJsonPath = join(cwd, 'package.json')
  return existsSync(packageJsonPath) ? packageJsonPath : null
}

export function findWorkspaceRoot(
  cwd: string = process.cwd(),
  packageManager?: PackageManager
): string | null {
  if (!packageManager) {
    const detected = PackageManagerDetector.detect(cwd)
    packageManager = detected.name
  }

  return PackageManagerDetector.findWorkspaceRoot(cwd, packageManager)
}
