import { PackageSelectionState, VulnerabilityDisplayOptions } from '../../types'
import { shouldDisplayVulnerabilityForDependency } from '../presenters/vulnerability'

export interface FilterState {
  filterMode: boolean // Whether we're in filter/search input mode
  filterQuery: string // Current filter/search query
  // Dependency type visibility toggles
  showDependencies: boolean
  showDevDependencies: boolean
  showPeerDependencies: boolean
  showOptionalDependencies: boolean
  showOnlyVulnerable: boolean // When true, only show packages with vulnerabilities
}

/** The subset of filter state persisted across runs (transient search excluded). */
export type PersistedFilters = Omit<FilterState, 'filterMode' | 'filterQuery'>

export class FilterManager {
  private state: FilterState

  constructor(initial?: Partial<PersistedFilters>) {
    this.state = {
      filterMode: false,
      filterQuery: '',
      showDependencies: initial?.showDependencies ?? true,
      showDevDependencies: initial?.showDevDependencies ?? true,
      showPeerDependencies: initial?.showPeerDependencies ?? true,
      showOptionalDependencies: initial?.showOptionalDependencies ?? true,
      showOnlyVulnerable: initial?.showOnlyVulnerable ?? false,
    }
  }

  /** Snapshot of the persistable filter toggles (no transient search state). */
  getPersistableState(): PersistedFilters {
    return {
      showDependencies: this.state.showDependencies,
      showDevDependencies: this.state.showDevDependencies,
      showPeerDependencies: this.state.showPeerDependencies,
      showOptionalDependencies: this.state.showOptionalDependencies,
      showOnlyVulnerable: this.state.showOnlyVulnerable,
    }
  }

  getState(): FilterState {
    return { ...this.state }
  }

  isFilterMode(): boolean {
    return this.state.filterMode
  }

  getFilterQuery(): string {
    return this.state.filterQuery
  }

  enterFilterMode(preserveQuery: boolean = false): void {
    this.state.filterMode = true
    if (!preserveQuery) {
      this.state.filterQuery = ''
    }
  }

  exitFilterMode(clearQuery: boolean = false): void {
    this.state.filterMode = false
    if (clearQuery) {
      this.state.filterQuery = ''
    }
  }

  updateFilterQuery(query: string): void {
    this.state.filterQuery = query
  }

  appendToFilterQuery(char: string): void {
    this.state.filterQuery += char
  }

  deleteFromFilterQuery(): void {
    if (this.state.filterQuery.length > 0) {
      this.state.filterQuery = this.state.filterQuery.slice(0, -1)
    }
  }

  toggleDependencyType(type: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'): void {
    switch (type) {
      case 'dependencies':
        this.state.showDependencies = !this.state.showDependencies
        break
      case 'devDependencies':
        this.state.showDevDependencies = !this.state.showDevDependencies
        break
      case 'peerDependencies':
        this.state.showPeerDependencies = !this.state.showPeerDependencies
        break
      case 'optionalDependencies':
        this.state.showOptionalDependencies = !this.state.showOptionalDependencies
        break
    }
  }

  toggleVulnerableFilter(): void {
    this.state.showOnlyVulnerable = !this.state.showOnlyVulnerable
  }

  isVulnerableFilterActive(): boolean {
    return this.state.showOnlyVulnerable
  }

  getActiveFilterLabel(): string {
    const activeTypes: string[] = []
    if (this.state.showDependencies) activeTypes.push('Deps')
    if (this.state.showDevDependencies) activeTypes.push('Dev')
    if (this.state.showPeerDependencies) activeTypes.push('Peer')
    if (this.state.showOptionalDependencies) activeTypes.push('Optional')

    if (activeTypes.length === 0) return 'None'
    const label = activeTypes.join(', ')
    return this.state.showOnlyVulnerable ? label + ' (vulnerable only)' : label
  }

  getFilteredStates(
    allStates: PackageSelectionState[],
    options: VulnerabilityDisplayOptions = {}
  ): PackageSelectionState[] {
    let filtered = allStates

    // Apply text filter
    if (this.state.filterQuery) {
      const query = this.state.filterQuery.toLowerCase()
      filtered = filtered.filter((state) => state.name.toLowerCase().includes(query))
    }

    // Apply dependency type filter
    filtered = filtered.filter((state) => {
      switch (state.type) {
        case 'dependencies':
          return this.state.showDependencies
        case 'devDependencies':
          return this.state.showDevDependencies
        case 'peerDependencies':
          return this.state.showPeerDependencies
        case 'optionalDependencies':
          return this.state.showOptionalDependencies
        default:
          return true
      }
    })

    // Apply vulnerability filter
    if (this.state.showOnlyVulnerable) {
      filtered = filtered.filter(
        (state) =>
          shouldDisplayVulnerabilityForDependency(state.type, options) &&
          !!state.vulnerability &&
          state.vulnerability.count > 0
      )
    }

    return filtered
  }
}
