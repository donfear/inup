export type { DispatchContext } from './action-dispatcher'
export { dispatchAction } from './action-dispatcher'
export { runInteractiveSession } from './interactive-session'
export { SelectionList } from './selection-list'
export {
  createPendingSelectionStates,
  createSelectionStates,
  createUpgradeChoices,
  deduplicatePackages,
  selectionKey,
} from './selection-state-builder'
