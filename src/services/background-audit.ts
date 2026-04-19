import { debugLog } from '../utils'

export interface AuditPackageInput {
  name: string
  version: string
}

export interface AuditBatch {
  packages: Map<string, string>
  packageNames: string[]
}

export class BackgroundAuditTracker {
  private pending = new Map<string, string>()
  private inFlight = new Set<string>()
  private completed = new Set<string>()

  enqueue(packages: AuditPackageInput[]): number {
    let added = 0

    for (const pkg of packages) {
      if (!pkg.name || !pkg.version) continue
      if (
        this.pending.has(pkg.name) ||
        this.inFlight.has(pkg.name) ||
        this.completed.has(pkg.name)
      ) {
        continue
      }
      this.pending.set(pkg.name, pkg.version)
      added++
    }

    if (added > 0) {
      debugLog.info('background-audit', `queued ${added} package(s)`)
    }

    return added
  }

  reserveNextBatch(limit: number = 20): AuditBatch {
    const packages = new Map<string, string>()
    const packageNames: string[] = []

    for (const [name, version] of this.pending) {
      packages.set(name, version)
      packageNames.push(name)
      this.pending.delete(name)
      this.inFlight.add(name)

      if (packageNames.length >= limit) {
        break
      }
    }

    return { packages, packageNames }
  }

  markCompleted(packageNames: string[]): void {
    for (const packageName of packageNames) {
      this.inFlight.delete(packageName)
      this.completed.add(packageName)
    }
  }

  getProgress(): { completed: number; total: number; isRunning: boolean; hasData: boolean } {
    const total = this.pending.size + this.inFlight.size + this.completed.size
    return {
      completed: this.completed.size,
      total,
      isRunning: this.pending.size > 0 || this.inFlight.size > 0,
      hasData: this.completed.size > 0,
    }
  }
}
