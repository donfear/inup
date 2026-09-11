import chalk from 'chalk'

// chalk sniffs the terminal once at import. Under `pool: 'threads'` workers share the parent's
// stdout, so a local TTY turns colors on while CI (no TTY) keeps them off. Pin level 0 so every
// run renders the same; tests about escape codes set `chalk.level` themselves and restore it.
chalk.level = 0
