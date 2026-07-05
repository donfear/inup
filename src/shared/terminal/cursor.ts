export const RAW_EXIT_ALT_SCREEN = '\x1b[?1049l'
export const RAW_SHOW_CURSOR = '\x1b[?25h'

export const CursorUtils = {
  /**
   * Switch to the terminal alternate screen buffer.
   */
  enterAlternateScreen(): void {
    process.stdout.write('\x1b[?1049h')
  },

  /**
   * Return to the terminal primary screen buffer.
   */
  exitAlternateScreen(): void {
    process.stdout.write('\x1b[?1049l')
  },

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
   * Clear the full screen and move the cursor to the top-left corner.
   */
  clearScreen(): void {
    process.stdout.write('\x1b[2J\x1b[H')
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
   * Show a progress message on the current line (overwrites previous content).
   * Written to stderr so stdout stays clean for --json / piped output, and only
   * when stderr is a TTY — the \r animation is just noise in a redirected log.
   */
  showProgress(message: string): void {
    if (!process.stderr.isTTY) return
    process.stderr.write(`\r${' '.repeat(ConsoleUtils.LINE_WIDTH)}\r${message}`)
  },

  /**
   * Clear the current progress line
   */
  clearProgress(): void {
    if (!process.stderr.isTTY) return
    process.stderr.write(`\r${' '.repeat(ConsoleUtils.LINE_WIDTH)}\r`)
  },
}
