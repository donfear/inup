import { PackageSelectionState } from '../../types'

export interface FilterState {
  filterMode: boolean // Whether we're in filter/search input mode
  filterQuery: string // Current filter/search query
  // Dependency type visibility toggles
  showDependencies: boolean
  showDevDependencies: boolean
  showPeerDependencies: boolean
  showOptionalDependencies: boolean
}

export class FilterManager {
  private state: FilterState

  constructor() {
    this.state = {
      filterMode: false,
      filterQuery: '',
      showDependencies: true,
      showDevDependencies: true,
      showPeerDependencies: true,
      showOptionalDependencies: true,
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

  enterFilterMode(): void {
    this.state.filterMode = true
    this.state.filterQuery = ''
  }

  exitFilterMode(): void {
    this.state.filterMode = false
    this.state.filterQuery = ''
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

  getActiveFilterLabel(): string {
    const activeTypes: string[] = []
    if (this.state.showDependencies) activeTypes.push('Deps')
    if (this.state.showDevDependencies) activeTypes.push('Dev')
    if (this.state.showPeerDependencies) activeTypes.push('Peer')
    if (this.state.showOptionalDependencies) activeTypes.push('Optional')

    if (activeTypes.length === 0) return 'None'
    return activeTypes.join(', ')
  }

  getFilteredStates(allStates: PackageSelectionState[]): PackageSelectionState[] {
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

    return filtered
  }
}
