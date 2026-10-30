/**
 * List order for package names, wherever inup shows or looks them up: scoped packages first,
 * then by name. The picker's rows, the order registry lookups go out in and the `--json` report
 * all follow it, so lookups come back roughly in the order the list shows them.
 */
export function comparePackageNames(a: string, b: string): number {
  const aIsScoped = a.startsWith('@')
  const bIsScoped = b.startsWith('@')
  if (aIsScoped && !bIsScoped) return -1
  if (!aIsScoped && bIsScoped) return 1
  return a.localeCompare(b)
}

/** Inserts `name` into `names`, which is in list order, after any equal name. */
export function insertInListOrder(names: string[], name: string): void {
  let low = 0
  let high = names.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (comparePackageNames(names[mid], name) <= 0) low = mid + 1
    else high = mid
  }
  names.splice(low, 0, name)
}
