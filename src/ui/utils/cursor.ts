/**
 * Cursor and terminal utility functions
 */

export const CursorUtils = {
  /**
   * Hide the cursor in the terminal
   */
  hide(): void {
    process.stdout.write('\x1b[?25l')
  },

  /**
   * Show the cursor in the terminal
   */
  show(): void {
    process.stdout.write('\x1b[?25h')
  },

  /**
   * Move cursor to home position (top-left corner)
   */
  moveToHome(): void {
    process.stdout.write('\x1b[H')
  },

  /**
   * Clear display from cursor to end of screen
   */
  clearToEndOfScreen(): void {
    process.stdout.write('\x1b[J')
  },

  /**
   * Clean up terminal state - restore cursor and disable raw mode.
   * Used when exiting interactive mode.
   */
  cleanup(): void {
    CursorUtils.show()
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false)
    }
    process.stdin.pause()
  },
}

/**
 * Console utilities for progress display and line clearing
 */
export const ConsoleUtils = {
  /**
   * Default line width for clearing progress messages
   */
  LINE_WIDTH: 80,

  /**
   * Show a progress message on the current line (overwrites previous content)
   */
  showProgress(message: string): void {
    process.stdout.write(`\r${' '.repeat(ConsoleUtils.LINE_WIDTH)}\r${message}`)
  },

  /**
   * Clear the current progress line
   */
  clearProgress(): void {
    process.stdout.write('\r' + ' '.repeat(ConsoleUtils.LINE_WIDTH) + '\r')
  },
}
