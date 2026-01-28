Output docs/demo/interactive-upgrade.gif

Set Shell zsh
Set FontSize 14
Set Width 1400
Set Height 800
Set PlaybackSpeed 1.0

# Change to clean temp directory (hidden from view)
Hide
Type "cd /tmp/my-app"
Enter
Type "clear"
Enter
Show

# Run inup
Type "inup"
Enter

# Wait for the tool to scan and fetch package updates (reduced from 5s)
Sleep 2s

# Use 'M' to select all minor updates
Type "m"
Sleep 1s

# Press 'T' to open theme menu
Type "t"
Sleep 800ms

# Navigate down 1 positions to select a theme
Down
Sleep 300ms

# Press Enter to apply the selected theme
Enter
Sleep 800ms

# Demonstrate search functionality - press '/' to enter search mode
Type "/"
Sleep 600ms

# Type 'express' to search for the express package
Type "express"
Sleep 800ms

# Navigate down to see the express package
Down
Sleep 400ms

# Show version selection in search mode - press right to see patch version
Right
Sleep 600ms

# Press right again to see major version
Right
Sleep 600ms

# Press left to go back to minor version
Left
Sleep 400ms


# Exit search mode with Escape
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

# Navigate down 1 package (leave with minor selection from M)
Down
Sleep 400ms

# Navigate down 1 more package
Down
Sleep 400ms

# Navigate down 2 more packages to demonstrate info modal
Down
Sleep 400ms
Down
Sleep 400ms

# Press 'i' to show info modal for current package
Type "i"
Sleep 1.5s

# Press 'i' again to toggle info modal
Type "i"
Sleep 400ms

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

# Wait for pnpm install to complete (reduced from 5s)
Sleep 3s
