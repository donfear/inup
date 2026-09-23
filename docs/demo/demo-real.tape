# record-demo.sh always passes -o with a fresh temporary path, which overrides
# this line. It stays deliberately generic so a bare `vhs demo-real.tape` run
# cannot overwrite the tracked demo assets.
Output recording.gif

Set Shell bash
Set PlaybackSpeed 1.0
# Rendered at 2x density for crispness. This VHS (0.10) has no `Set Scale`, so
# the hi-DPI look comes from drawing everything twice as large — FontSize 32 on
# a 2480x1020 canvas is ~2x the pixels-per-glyph of a 1x render, i.e. Retina
# sharp. record-demo.sh downscales the GIF back to 1240 wide (small README
# asset). Keep Width/Height a
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
Type `cd "$VHS_DEMO_DIR"`
Enter
# Bind the exact wrapper inside the recorded shell, independent of its PATH.
Type `inup() { "$VHS_DEMO_DIR/.bin/inup" "$@"; }`
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

# Stay hidden through launch and resume the instant the picker paints, so the
# demo opens on the UI rather than on a shell prompt and node's startup. The
# picker mounts before the scan, so this still shows the real loading screen
# with rows streaming in, rather than cutting to an already-finished list.
Type "inup"
Enter
Wait+Screen@30s /q Quit/
Show

# Every package resolved (the audit counter tracks resolved packages), so the
# first keypress can never land on a half-loaded list no matter how slow the
# runner or the registry is. If this times out the recording fails loudly
# instead of publishing a half-scanned demo.
# ('.' stands in for the slash: the tape lexer ends the pattern at a literal /.)
# 36 = every distinct name + range the demo project declares: react is declared at
# two ranges, and each declared version is audited on its own.
Wait+Screen@60s /Audit 36.36/
Sleep 700ms

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
