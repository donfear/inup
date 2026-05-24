import { PackageSelectionState, RenderableItem } from '../../types'

const GROUP_THRESHOLD = 2

function getScope(name: string): string | null {
  if (!name.startsWith('@')) return null
  const slash = name.indexOf('/')
  return slash === -1 ? null : name.slice(0, slash)
}

export interface ScopeGroupingOptions {
  collapsedScopes?: ReadonlySet<string>
}

export function buildScopeGroupedItems(
  states: PackageSelectionState[],
  options: ScopeGroupingOptions = {}
): RenderableItem[] {
  if (states.length === 0) return []
  const collapsed = options.collapsedScopes ?? new Set<string>()

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

    const isCollapsed = collapsed.has(scope)
    items.push({
      type: 'group-header',
      scope,
      memberIndices: [...indices],
      collapsed: isCollapsed,
    })

    if (isCollapsed) continue

    indices.forEach((i, idx) => {
      items.push({
        type: 'package',
        state: states[i],
        originalIndex: i,
        groupPosition: idx === indices.length - 1 ? 'last' : 'middle',
      })
    })
  }

  emitStandaloneUpTo(states.length)

  return items
}
