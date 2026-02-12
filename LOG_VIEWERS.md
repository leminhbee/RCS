# RCS Log Viewer Scripts

Three convenient ways to watch your RCS logs in real-time.

## Quick Start

```bash
# Make scripts executable first (on your remote server)
chmod +x watch-logs*.sh

# Option 1: Merged timeline view (easiest)
./watch-logs-simple.sh

# Option 2: Split screen with 4 panes
./watch-logs-multitail.sh

# Option 3: Tmux with custom layout
./watch-logs.sh
```

## Option 1: lnav (Merged View) - Recommended for Tracing

**Script:** `./watch-logs-simple.sh`

**Requirements:**
```bash
sudo apt-get install lnav
```

**What it does:**
- Merges all logs into one timeline view
- Sorted by timestamp
- Color-coded by file
- Perfect for tracing requests across domains

**Keyboard Shortcuts:**
- `/` - Search
- `TAB` - Cycle through individual files
- `:filter-in <pattern>` - Filter logs
- `q` - Quit
- `?` - Help

**Example Filters:**
```
:filter-in correlationId.*MSG123
:filter-in operation.*add
:filter-in level.*error
```

## Option 2: multitail (Split Panes) - Best for Monitoring

**Script:** `./watch-logs-multitail.sh`

**Requirements:**
```bash
sudo apt-get install multitail jq
```

**What it does:**
- Shows 4 logs in split screen
- Each pane labeled (QUEUE, CALLS, STATUSES, ERRORS)
- JSON pretty-printed with colors
- Great for monitoring multiple domains

**Keyboard Shortcuts:**
- `b` - Select which window to focus
- `q` - Quit

## Option 3: tmux (Advanced Layout) - Most Flexible

**Script:** `./watch-logs.sh`

**Requirements:**
```bash
sudo apt-get install tmux jq
```

**What it does:**
- Creates 4-pane tmux session
- Layout:
  ```
  +------------------+------------------+
  |   QUEUE          |   CALLS          |
  +------------------+------------------+
  |   STATUSES       |   ERRORS         |
  +------------------+------------------+
  ```

**Keyboard Shortcuts:**
- `Ctrl+b` then arrow keys - Navigate between panes
- `Ctrl+b` then `z` - Zoom into/out of current pane
- `Ctrl+b` then `[` - Scroll mode (q to exit)
- `Ctrl+b` then `d` - Detach (session keeps running)
- `tmux attach -t rcs-logs` - Reattach to session

**Advanced:**
```bash
# Detach and leave running in background
Ctrl+b, d

# Reattach later
tmux attach -t rcs-logs

# Kill session
tmux kill-session -t rcs-logs
```

## Custom Filtering

You can modify any script to filter specific operations:

### Watch only errors:
```bash
tail -f /home/ubuntu/RCS/LOGS/LOGS.json | jq -C 'select(.level == "error")'
```

### Watch specific caller:
```bash
tail -f /home/ubuntu/RCS/LOGS/LOGS_QUEUE.json | jq -C 'select(.callerNumber == "5551234567")'
```

### Trace specific message:
```bash
tail -f /home/ubuntu/RCS/LOGS/LOGS.json | jq -C 'select(.correlationId == "MSG123")'
```

## My Recommendation

**For tracing requests:** Use `./watch-logs-simple.sh` (lnav)
- Easy to search across all domains
- See complete call flow by timestamp

**For live monitoring:** Use `./watch-logs-multitail.sh`
- Watch multiple domains simultaneously
- Quickly spot issues in any domain

**For power users:** Use `./watch-logs.sh` (tmux)
- Most flexible
- Can detach and reattach
- Customize layout as needed

## Troubleshooting

### "Command not found" errors
Install missing tools:
```bash
sudo apt-get update
sudo apt-get install lnav multitail tmux jq
```

### Permission denied
Make scripts executable on your remote server:
```bash
chmod +x watch-logs*.sh
```

### Wrong log directory
Edit the script and change `LOG_DIR` variable to match your setup.
