import { debugLog } from '../../shared/debug-logger'
import type { AuditProgress } from '../../shared/types'
import { type AuditPackageInput, auditKey } from './per-version-audit'

export interface AuditBatch {
  packages: AuditPackageInput[]
  keys: string[]
}

/** Work is keyed by `auditKey` (name + declared version), so each version is audited once. */
export class BackgroundAuditTracker {
  private pending = new Map<string, AuditPackageInput>()
  private inFlight = new Set<string>()
  private completed = new Set<string>()
  private failed = new Set<string>()

  enqueue(packages: AuditPackageInput[]): number {
    let added = 0

    for (const pkg of packages) {
      if (!pkg.name || !pkg.version) continue
      const key = auditKey(pkg.name, pkg.version)
      if (this.pending.has(key) || this.inFlight.has(key) || this.completed.has(key)) {
        continue
      }
      // A failed audit is not a result: queueing it again retries it.
      this.failed.delete(key)
      this.pending.set(key, { name: pkg.name, version: pkg.version })
      added++
    }

    if (added > 0) {
      debugLog.info('background-audit', `queued ${added} package(s)`)
    }

    return added
  }

  reserveNextBatch(limit: number = 20): AuditBatch {
    const packages: AuditPackageInput[] = []
    const keys: string[] = []

    for (const [key, pkg] of this.pending) {
      packages.push(pkg)
      keys.push(key)
      this.pending.delete(key)
      this.inFlight.add(key)

      if (keys.length >= limit) {
        break
      }
    }

    return { packages, keys }
  }

  markCompleted(keys: string[]): void {
    for (const key of keys) {
      this.inFlight.delete(key)
      this.completed.add(key)
    }
  }

  markFailed(keys: string[]): void {
    for (const key of keys) {
      this.inFlight.delete(key)
      this.failed.add(key)
    }
  }

  getProgress(): AuditProgress {
    // A failed package is done (it counts toward the progress) but produced no data.
    const done = this.completed.size + this.failed.size
    return {
      completed: done,
      total: this.pending.size + this.inFlight.size + done,
      failed: this.failed.size,
      isRunning: this.pending.size > 0 || this.inFlight.size > 0,
      hasData: this.completed.size > 0,
    }
  }
}
