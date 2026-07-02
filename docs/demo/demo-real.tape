Output docs/demo/interactive-upgrade.gif

Set Shell bash
Set PlaybackSpeed 1.0
# Width/Height include a 20px Padding on every side, so the usable terminal grid
# stays 1200x470 while inup's full-height panel borders get breathing room from the
# video edge (Padding 0 jammed the bottom/edge borders flush against the frame).
Set Width 1240
Set Height 510
Set FontSize 16
Set Padding 20

# Change to clean temp directory (hidden from view)
Hide
Type "cd /tmp/my-app"
Enter
# Clear CI so inup renders the interactive TUI. GitHub Actions sets CI=true, which
# the VHS-spawned shell inherits and which would otherwise route inup to its headless
# (non-interactive) report path, leaving the tape's keystrokes to leak into bash.
Type "unset CI"
Enter
Type `export PS1='$ '`
Enter
Type "clear"
Enter
Show

# Run inup and hide shell/loading so the demo opens directly on the CLI
Hide
Type "inup"
Enter
Sleep 5s
Show

# Use 'M' to select all minor updates
Type "m"
Sleep 600ms

# Demonstrate search functionality - press '/' to enter search mode
Type "/"
Sleep 600ms

# Type 'express' to search for the express package
Type "express"
Sleep 600ms

# Press Enter to apply the search filter
Enter
Sleep 600ms

# Show the applied search UI - navigate and select versions
Down
Sleep 400ms

# Show version selection - press right to select
Right
Sleep 600ms

# Press right again to see major version
Right
Sleep 600ms

# Press left to go back to minor version
Left
Sleep 400ms

# Clear search filter with Escape to show all packages again
Ctrl+[
Sleep 600ms

# Navigate down 2 packages
Down
Sleep 400ms
Down
Sleep 400ms

# Select major version for this package (right arrow)
Right
Sleep 600ms

Up
Sleep 400ms

# Press 'i' to show info modal for current package
Type "i"
Sleep 3s

# Press 'i' again to toggle info modal
Type "i"
Sleep 400ms

# Select major version for this package (right arrow)
Right
Sleep 600ms

# Navigate back up
Up
Sleep 400ms
# Navigate left
Left
Sleep 400ms

# Quick pause to show final selections
Sleep 1s

# Press Enter to confirm selections
Enter
Sleep 500ms

# Press Enter again to confirm installation
Enter

# Install to complete
Sleep 1s
