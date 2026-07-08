Output docs/demo/interactive-upgrade.gif

Set Shell bash
Set PlaybackSpeed 1.0
# Rendered at 2x density for crispness. This VHS (0.10) has no `Set Scale`, so
# the hi-DPI look comes from drawing everything twice as large — FontSize 32 on
# a 2480x1020 canvas is ~2x the pixels-per-glyph of a 1x render, i.e. Retina
# sharp. record-demo.sh downscales the GIF back to 1240 wide (small README
# asset) and keeps the mp4 at full 2x for the website hero. Keep Width/Height a
# clean 2x of the old 1240x510 so the framing is unchanged. Padding scales too
# (40 = 2x20) so inup's full-height panel borders keep their breathing room.
Set Width 2480
Set Height 1020
Set FontSize 32
Set Padding 40
# A steady framerate keeps motion smooth without bloating the GIF.
Set Framerate 30

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
