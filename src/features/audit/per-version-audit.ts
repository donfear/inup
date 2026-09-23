import { fetchVulnerabilities, type PackageVulnerabilities } from './vulnerability-checker'

export interface AuditPackageInput {
  name: string
  version: string
}

/**
 * Audit results belong to a declared version, not to a package name: a monorepo can declare
 * lodash@^3 in one workspace and lodash@^4 in another, and each must get its own advisories.
 */
export function auditKey(name: string, version: string): string {
  return `${name}@${version}`
}

/**
 * Advisories for every (name, declared version) pair, keyed by `auditKey`. The bulk endpoint takes
 * one version per name, so the pairs go out in rounds with unique names: a single request when no
 * name repeats, one more per extra version of the most-duplicated name. Rejects when any round
 * fails if `rejectOnFailure` is set; otherwise best-effort like `fetchVulnerabilities`.
 */
export async function fetchVulnerabilitiesPerVersion(
  packages: AuditPackageInput[],
  options: { rejectOnFailure?: boolean } = {}
): Promise<Map<string, PackageVulnerabilities>> {
  const rounds: Array<Map<string, string>> = []
  for (const { name, version } of packages) {
    if (rounds.some((round) => round.get(name) === version)) continue
    const round = rounds.find((candidate) => !candidate.has(name))
    if (round) round.set(name, version)
    else rounds.push(new Map([[name, version]]))
  }

  const responses = await Promise.all(rounds.map((round) => fetchVulnerabilities(round, options)))

  const results = new Map<string, PackageVulnerabilities>()
  rounds.forEach((round, index) => {
    for (const [name, version] of round) {
      const found = responses[index].get(name)
      if (found) results.set(auditKey(name, version), found)
    }
  })
  return results
}
