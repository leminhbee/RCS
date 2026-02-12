#!/bin/bash

# Pretty-printed merged view of all RCS logs using tail and jq
# This version guarantees pretty-printed JSON with proper indentation,
# shows which file each log is from, and uses color coding

LOG_DIR="/home/ubuntu/RCS/LOGS"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "jq not installed."
    echo "Install with:"
    echo "  Ubuntu/Debian: sudo apt-get install jq"
    echo "  macOS: brew install jq"
    exit 1
fi

# Color codes
RESET='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

# File colors
FILE_COLOR='\033[1;36m'      # Cyan bold for file headers
FILE_BORDER='\033[36m'       # Cyan for borders

# Log level colors (will be applied based on level field)
INFO_COLOR='\033[32m'        # Green
WARN_COLOR='\033[33m'        # Yellow
ERROR_COLOR='\033[1;31m'     # Red bold

echo "Watching RCS logs with pretty-printed, color-coded JSON..."
echo "Press Ctrl+C to exit"
echo ""
echo "Logs being watched:"
echo "  - LOGS.json (all logs)"
echo "  - LOGS_QUEUE.json"
echo "  - LOGS_CALLS.json"
echo "  - LOGS_STATUSES.json"
echo "  - LOGS_CASES.json"
echo "  - LOGS_CHATS.json"
echo "  - LOGS_ERRORS.json"
echo ""
echo -e "${FILE_BORDER}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# Tail all logs and pretty-print JSON with file labels and colors
current_file=""
tail -f \
  "$LOG_DIR"/LOGS.json \
  "$LOG_DIR"/LOGS_QUEUE.json \
  "$LOG_DIR"/LOGS_CALLS.json \
  "$LOG_DIR"/LOGS_STATUSES.json \
  "$LOG_DIR"/LOGS_CASES.json \
  "$LOG_DIR"/LOGS_CHATS.json \
  "$LOG_DIR"/LOGS_ERRORS.json \
  2>/dev/null | while IFS= read -r line; do
    # Check if this is a file header from tail (e.g., "==> LOGS.json <==")
    if [[ "$line" =~ ^==\>\ (.*)\ \<==$ ]]; then
        current_file="${BASH_REMATCH[1]}"
        echo ""
        echo -e "${FILE_BORDER}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        echo -e "${FILE_COLOR}📄 $current_file${RESET}"
        echo -e "${FILE_BORDER}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        echo ""
    elif [ -n "$line" ]; then
        # Try to parse the log level for color coding
        log_level=$(echo "$line" | jq -r '.level // empty' 2>/dev/null)

        # Determine color based on log level (pino uses: 30=info, 40=warn, 50=error, 60=fatal)
        if [[ "$log_level" == "50" ]] || [[ "$log_level" == "60" ]]; then
            level_color="$ERROR_COLOR"
        elif [[ "$log_level" == "40" ]]; then
            level_color="$WARN_COLOR"
        else
            level_color="$INFO_COLOR"
        fi

        # Pretty-print JSON with color
        if echo "$line" | jq -C . 2>/dev/null | sed "s/^/${level_color}/; s/$/${RESET}/"; then
            echo "" # Add blank line between entries for readability
        else
            # If not JSON, just print it
            echo "$line"
        fi
    fi
done
