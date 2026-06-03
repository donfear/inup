export { runInteractiveSession } from './interactive-session'
export {
  createSelectionStates,
  createPendingSelectionStates,
  createIgnoredSelectionStates,
  createUpgradeChoices,
  deduplicatePackages,
  comparePackageNames,
} from './selection-state-builder'
export { dispatchAction } from './action-dispatcher'
export type { DispatchContext } from './action-dispatcher'
