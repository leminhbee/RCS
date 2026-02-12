#!/bin/bash

# RCS Log Viewer - Watch multiple logs in split panes
# Usage: ./watch-logs.sh

LOG_DIR="/home/ubuntu/RCS/LOGS"
SESSION_NAME="rcs-logs"

# Check if tmux is installed
if ! command -v tmux &> /dev/null; then
    echo "tmux not installed. Install with: sudo apt-get install tmux"
    exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "jq not installed. Install with: sudo apt-get install jq"
    exit 1
fi

# Kill existing session if it exists
tmux kill-session -t $SESSION_NAME 2>/dev/null

# Create new session with first pane (QUEUE)
tmux new-session -d -s $SESSION_NAME -n "RCS Logs"

# Split window into 4 panes
# Layout:
# +------------------+------------------+
# |   QUEUE          |   CALLS          |
# +------------------+------------------+
# |   GENERAL        |   ERRORS         |
# +------------------+------------------+

# Split vertically to create 2 columns
tmux split-window -h -t $SESSION_NAME

# Split left column horizontally
tmux split-window -v -t $SESSION_NAME:0.0

# Split right column horizontally
tmux split-window -v -t $SESSION_NAME:0.1

# Now send commands to each pane
tmux send-keys -t $SESSION_NAME:0.0 "tail -f $LOG_DIR/LOGS_QUEUE.json | jq -C" C-m
tmux send-keys -t $SESSION_NAME:0.1 "tail -f $LOG_DIR/LOGS_CALLS.json | jq -C" C-m
tmux send-keys -t $SESSION_NAME:0.2 "tail -f $LOG_DIR/LOGS.json | jq -C" C-m
tmux send-keys -t $SESSION_NAME:0.3 "tail -f $LOG_DIR/LOGS_ERRORS.json | jq -C" C-m

# Select first pane
tmux select-pane -t $SESSION_NAME:0.0

# Attach to session
tmux attach-session -t $SESSION_NAME
