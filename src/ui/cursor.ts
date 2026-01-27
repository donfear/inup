/**
 * Cursor utility functions for terminal control
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
}
