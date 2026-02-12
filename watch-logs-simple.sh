#!/bin/bash

# Simple merged view of all RCS logs using lnav
# Usage: ./watch-logs-simple.sh

LOG_DIR="/home/ubuntu/RCS/LOGS"

# Check if lnav is installed
if ! command -v lnav &> /dev/null; then
    echo "lnav not installed."
    echo "Install with:"
    echo "  Ubuntu/Debian: sudo apt-get install lnav"
    echo "  macOS: brew install lnav"
    exit 1
fi

# Watch all logs in merged timeline view
echo "Starting lnav with all RCS logs..."
echo ""
echo "==> FIRST TIME: Press 'p' to enable pretty-print for nested objects! <=="
echo ""
echo "Navigation Shortcuts:"
echo "  Shift+G - Jump to end (newest logs)"
echo "  g       - Jump to top (oldest logs)"
echo "  /       - Search"
echo "  TAB     - Cycle through files"
echo "  q       - Quit"
echo ""
echo "JSON Viewing Shortcuts:"
echo "  p       - Toggle pretty-print (PRESS THIS for multi-level objects!)"
echo "  [       - Collapse current JSON object"
echo "  ]       - Expand current JSON object"
echo "  {       - Previous top-level JSON field"
echo "  }       - Next top-level JSON field"
echo "  :       - Command mode (type commands)"
echo ""
echo "Useful Commands (press : first):"
echo "  :filter-in <pattern>  - Only show matching lines"
echo "  :filter-out <pattern> - Hide matching lines"
echo "  :clear-filter         - Remove all filters"
echo ""

# Start lnav
lnav "$LOG_DIR"/LOGS_*.json
