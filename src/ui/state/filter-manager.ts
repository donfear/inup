import { PackageSelectionState } from '../../types'

export interface FilterState {
  filterMode: boolean // Whether we're in filter/search input mode
  filterQuery: string // Current filter/search query
}

export class FilterManager {
  private state: FilterState

  constructor() {
    this.state = {
      filterMode: false,
      filterQuery: '',
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

  getFilteredStates(allStates: PackageSelectionState[]): PackageSelectionState[] {
    if (!this.state.filterQuery) {
      return allStates
    }
    const query = this.state.filterQuery.toLowerCase()
    return allStates.filter((state) => state.name.toLowerCase().includes(query))
  }
}
