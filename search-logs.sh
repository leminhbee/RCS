#!/bin/bash

# Search logs for one or more strings and save results to a new file
# Usage: ./search-logs.sh [-a|--and] [-l|--log <logfile>] "search term" ["term2" "term3" ...]

LOG_DIR="/home/ubuntu/RCS/LOGS"
LOG_NAME="LOGS.json"
RESULTS_DIR="$LOG_DIR/search_results"

# Parse flags
LOGIC_MODE="OR"  # Default to OR logic
while [[ "$1" == -* ]]; do
    case "$1" in
        -a|--and)
            LOGIC_MODE="AND"
            shift
            ;;
        -l|--log)
            LOG_NAME="$2"
            shift 2
            ;;
        *)
            echo "Unknown flag: $1"
            exit 1
            ;;
    esac
done

LOG_FILE="$LOG_DIR/$LOG_NAME"

# Check if search term was provided
if [ -z "$1" ]; then
    echo "Usage: ./search-logs.sh [-a|--and] [-l|--log <logfile>] \"search term\" [\"term2\" \"term3\" ...]"
    echo ""
    echo "Flags:"
    echo "  -a, --and          Use AND logic (matches ALL terms) instead of OR (matches ANY term)"
    echo "  -l, --log <file>   Log file name to search (default: LOGS.json)"
    echo ""
    echo "Examples:"
    echo "  Single search:"
    echo "    ./search-logs.sh \"error\""
    echo "    ./search-logs.sh \"1234567890\""
    echo ""
    echo "  Search a specific log file:"
    echo "    ./search-logs.sh -l app.json \"error\""
    echo "    ./search-logs.sh --log errors.json \"timeout\""
    echo ""
    echo "  Multiple searches with OR logic (default - matches ANY term):"
    echo "    ./search-logs.sh \"error\" \"warn\""
    echo "    ./search-logs.sh \"queue\" \"CALL_ANSWERED\""
    echo "    ./search-logs.sh \"5551234567\" \"5559876543\""
    echo ""
    echo "  Multiple searches with AND logic (matches ALL terms):"
    echo "    ./search-logs.sh -a \"queue\" \"5551234567\""
    echo "    ./search-logs.sh --and \"error\" \"CALL_ANSWERED\""
    echo "    ./search-logs.sh -a \"domain\" \"calls\" \"messageId123\""
    exit 1
fi

# Check if jq is installed (for pretty output)
if ! command -v jq &> /dev/null; then
    echo "Warning: jq not installed. Results will not be pretty-printed."
    echo "Install with: sudo apt-get install jq (Ubuntu) or brew install jq (macOS)"
    HAS_JQ=false
else
    HAS_JQ=true
fi

# Create results directory if it doesn't exist
mkdir -p "$RESULTS_DIR"

# Build grep pattern for multiple search terms
SEARCH_TERMS=("$@")
GREP_PATTERN=""
FILENAME_PART=""

if [ "$LOGIC_MODE" == "AND" ]; then
    echo "Searching for ($LOGIC_MODE logic - matches ALL of these terms):"
    FILENAME_PART=""
    for term in "${SEARCH_TERMS[@]}"; do
        echo "  - \"$term\""
        if [ -z "$FILENAME_PART" ]; then
            FILENAME_PART=$(echo "$term" | tr ' /\\:*?"<>|' '_' | tr -s '_')
        else
            SAFE_TERM=$(echo "$term" | tr ' /\\:*?"<>|' '_' | tr -s '_')
            FILENAME_PART="${FILENAME_PART}_AND_${SAFE_TERM}"
        fi
    done
else
    echo "Searching for ($LOGIC_MODE logic - matches ANY of these terms):"
    for term in "${SEARCH_TERMS[@]}"; do
        echo "  - \"$term\""
        if [ -z "$GREP_PATTERN" ]; then
            GREP_PATTERN="$term"
            FILENAME_PART=$(echo "$term" | tr ' /\\:*?"<>|' '_' | tr -s '_')
        else
            GREP_PATTERN="$GREP_PATTERN|$term"
            SAFE_TERM=$(echo "$term" | tr ' /\\:*?"<>|' '_' | tr -s '_')
            FILENAME_PART="${FILENAME_PART}_OR_${SAFE_TERM}"
        fi
    done
fi

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="$RESULTS_DIR/search_${FILENAME_PART}_${TIMESTAMP}.json"

echo ""
echo "Log file: $LOG_FILE"
echo "Output file: $OUTPUT_FILE"
echo ""
echo "Searching..."
echo ""

# Search for the terms and save to output file
if [ "$LOGIC_MODE" == "AND" ]; then
    # AND logic: pipe multiple greps together
    if [ "$HAS_JQ" = true ]; then
        # Build piped grep command for AND logic
        GREP_CMD="cat \"$LOG_FILE\""
        for term in "${SEARCH_TERMS[@]}"; do
            GREP_CMD="$GREP_CMD | grep -i \"$term\""
        done
        # Execute and pretty-print
        eval "$GREP_CMD" | while IFS= read -r line; do
            echo "$line" | jq .
        done > "$OUTPUT_FILE" 2>/dev/null
    else
        # Build piped grep command for AND logic without jq
        GREP_CMD="cat \"$LOG_FILE\""
        for term in "${SEARCH_TERMS[@]}"; do
            GREP_CMD="$GREP_CMD | grep -i \"$term\""
        done
        eval "$GREP_CMD" > "$OUTPUT_FILE"
    fi
else
    # OR logic: use grep -E with | (OR operator)
    if [ "$HAS_JQ" = true ]; then
        grep -Ei "$GREP_PATTERN" "$LOG_FILE" | while IFS= read -r line; do
            echo "$line" | jq .
        done > "$OUTPUT_FILE" 2>/dev/null
    else
        grep -Ei "$GREP_PATTERN" "$LOG_FILE" > "$OUTPUT_FILE"
    fi
fi

# Count results
MATCH_COUNT=$(grep -c . "$OUTPUT_FILE" 2>/dev/null || echo "0")

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Search complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Found: $MATCH_COUNT matching log entries"
echo "Results saved to: $OUTPUT_FILE"
echo ""

if [ "$MATCH_COUNT" -gt 0 ]; then
    echo "Preview (first 5 matches):"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [ "$HAS_JQ" = true ]; then
        head -n 5 "$OUTPUT_FILE"
    else
        head -n 5 "$OUTPUT_FILE" | while IFS= read -r line; do
            echo "$line" | jq -C . 2>/dev/null || echo "$line"
        done
    fi
    echo ""
    echo "To view all results: cat $OUTPUT_FILE"
    if [ "$HAS_JQ" = true ]; then
        echo "To view with jq: jq . $OUTPUT_FILE"
        echo "To view with colors: jq -C . $OUTPUT_FILE | less -R"
    fi
else
    echo "No matches found."
    rm "$OUTPUT_FILE"  # Remove empty file
fi
