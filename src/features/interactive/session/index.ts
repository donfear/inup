export type { DispatchContext } from './action-dispatcher'
export { dispatchAction } from './action-dispatcher'
export {
  type InteractiveSessionHandle,
  runInteractiveSession,
  type SessionDisplayOptions,
} from './interactive-session'
export { SelectionList } from './selection-list'
export {
  createSelectionStates,
  createUpgradeChoices,
  deduplicatePackages,
  selectionKey,
} from './selection-state-builder'
