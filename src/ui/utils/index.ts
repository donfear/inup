// Temporary shim during the feature-first migration: terminal primitives now
// live in shared/terminal and semver helpers in shared/versions. Removed when
// ui/ becomes features/interactive (P7).
export { VersionUtils, applyVersionPrefix, truncateMiddle, formatVersionDiff } from './version'
export {
  CursorUtils,
  ConsoleUtils,
  RAW_EXIT_ALT_SCREEN,
  RAW_SHOW_CURSOR,
} from '../../shared/terminal/cursor'
export { TerminalInput } from '../../shared/terminal/terminal-input'
export {
  getVisualLength,
  stripAnsi,
  truncatePlainText,
  wrapPlainText,
} from '../../shared/terminal/text'
