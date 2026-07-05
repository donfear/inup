export type { DispatchContext } from './action-dispatcher'
export { dispatchAction } from './action-dispatcher'
export { runInteractiveSession } from './interactive-session'
export {
  createPendingSelectionStates,
  createSelectionStates,
  createUpgradeChoices,
  deduplicatePackages,
  selectionKey,
} from './selection-state-builder'
