import { PackageSelectionState, RenderableItem } from '../../types'

const GROUP_THRESHOLD = 2

function getScope(name: string): string | null {
  if (!name.startsWith('@')) return null
  const slash = name.indexOf('/')
  return slash === -1 ? null : name.slice(0, slash)
}

export function buildScopeGroupedItems(states: PackageSelectionState[]): RenderableItem[] {
  if (states.length === 0) return []

  const scopeOrder: string[] = []
  const scopeBuckets = new Map<string, number[]>()
  const standalone: number[] = []

  states.forEach((state, index) => {
    const scope = getScope(state.name)
    if (scope === null) {
      standalone.push(index)
      return
    }
    if (!scopeBuckets.has(scope)) {
      scopeBuckets.set(scope, [])
      scopeOrder.push(scope)
    }
    scopeBuckets.get(scope)!.push(index)
  })

  const items: RenderableItem[] = []
  let nextStandalone = 0

  const emitStandaloneUpTo = (limitIndex: number) => {
    while (nextStandalone < standalone.length && standalone[nextStandalone] < limitIndex) {
      items.push({
        type: 'package',
        state: states[standalone[nextStandalone]],
        originalIndex: standalone[nextStandalone],
      })
      nextStandalone++
    }
  }

  for (const scope of scopeOrder) {
    const indices = scopeBuckets.get(scope)!
    const firstIndex = indices[0]
    emitStandaloneUpTo(firstIndex)

    if (indices.length < GROUP_THRESHOLD) {
      indices.forEach((i) => {
        items.push({ type: 'package', state: states[i], originalIndex: i })
      })
      continue
    }

    const versionCounts = new Map<string, number>()
    indices.forEach((i) => {
      const v = states[i].currentVersionSpecifier
      versionCounts.set(v, (versionCounts.get(v) || 0) + 1)
    })

    let majorityVersion = ''
    let majorityCount = 0
    for (const [v, c] of versionCounts) {
      if (c > majorityCount) {
        majorityVersion = v
        majorityCount = c
      }
    }

    if (majorityCount < GROUP_THRESHOLD) {
      indices.forEach((i) => {
        items.push({ type: 'package', state: states[i], originalIndex: i })
      })
      continue
    }

    const members = indices.filter((i) => states[i].currentVersionSpecifier === majorityVersion)
    const outliers = indices.filter((i) => states[i].currentVersionSpecifier !== majorityVersion)

    items.push({ type: 'group-header', scope, memberIndices: members })
    members.forEach((i, idx) => {
      items.push({
        type: 'package',
        state: states[i],
        originalIndex: i,
        groupPosition: idx === members.length - 1 ? 'last' : 'middle',
      })
    })
    outliers.forEach((i) => {
      items.push({ type: 'package', state: states[i], originalIndex: i })
    })
  }

  emitStandaloneUpTo(states.length)

  return items
}
