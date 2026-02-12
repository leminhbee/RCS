#!/bin/bash

# Watch multiple RCS logs in split panes using multitail
# Usage: ./watch-logs-multitail.sh

LOG_DIR="/home/ubuntu/RCS/LOGS"

# Check if multitail is installed
if ! command -v multitail &> /dev/null; then
    echo "multitail not installed."
    echo "Install with: sudo apt-get install multitail"
    exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "jq not installed."
    echo "Install with: sudo apt-get install jq"
    exit 1
fi

echo "Starting multitail with RCS logs..."
echo "Shortcuts:"
echo "  b       - Select which window to show"
echo "  q       - Quit"
echo ""

# Watch 4 logs in split view with compact JSON formatting
# Note: Remove -C from jq to avoid color code issues with multitail
multitail \
  --label "QUEUE" \
  -l "tail -f $LOG_DIR/LOGS_QUEUE.json | jq -c ." \
  --label "CALLS" \
  -l "tail -f $LOG_DIR/LOGS_CALLS.json | jq -c ." \
  --label "STATUSES" \
  -l "tail -f $LOG_DIR/LOGS_STATUSES.json | jq -c ." \
  --label "ERRORS" \
  -l "tail -f $LOG_DIR/LOGS_ERRORS.json | jq -c ."
