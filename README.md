# RCS

RingCentral Call Service — a webhook-driven Express server that processes RingCentral call events, syncs with Salesforce cases, updates agent Slack statuses, and powers a real-time dashboard via WebSocket.

## Prerequisites

- Node.js
- PM2 (process manager)
- Access to ATP, AVA, Salesforce, and Slack APIs (configured via `.env`)

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` (or create `.env`) and fill in the required values:

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default `3005`) |
| `ATP_URL` | ATP service URL |
| `AVA_URL` | AVA service URL |
| `SFDC_USERNAME` | Salesforce username |
| `SFDC_PASSWORD` | Salesforce password |
| `SFDC_TOKEN` | Salesforce security token |
| `SLACK_TOKEN` | Slack bot token |
| `DASHBOARD_KEY` | Secret key used in the dashboard URL path |

## Running

```bash
# Start with PM2
npm start

# Restart (reload with updated env)
npm run restart

# Format code
npm run format
```

Logs are written to `~/RCS/LOGS/out.log` and `~/RCS/LOGS/error.log`.

## API Endpoints

All webhook endpoints accept `POST` with JSON bodies (except Cases which uses XML). Every webhook returns `200 OK` immediately and processes asynchronously.

### Queue

| Method | Path | Description |
|--------|------|-------------|
| POST | `/queue/new` | New call enters the queue. Looks up caller in Salesforce, creates a case and QUEUED call record. |
| POST | `/queue/callback` | Caller requests a callback. Updates call record to CALLBACK_REQUESTED. |
| POST | `/queue/end` | Call exits the queue. `call_result` determines behavior: `ABANDON` closes the case, `CONNECTED`/`DEFLECTED` logs completion. |

### Calls

| Method | Path | Description |
|--------|------|-------------|
| POST | `/calls/ringing` | Call is ringing at an agent. Sets call record to RINGING and updates Slack status. |
| POST | `/calls/answer` | Agent picks up. Assigns Salesforce case owner, attaches recording URL, sets call to ACTIVE. |
| POST | `/calls/end` | Call ends. Marks call COMPLETE with duration. Handles outbound calls (`ONE-TO-ONE-OUTBOUND`) and RNA detection (no recording + prev state RINGING). |

### Statuses

| Method | Path | Description |
|--------|------|-------------|
| POST | `/statuses` | Agent status change. Updates Slack status and dashboard. Handles AVAILABLE, ENGAGED, LUNCH, ON-BREAK, TRAINING, OUTBOUND, LOGIN, LOGOUT, RNA-STATE, and more. Starts a 2-minute wrap-up timer on ENGAGED -> AVAILABLE transitions. |

### Cases

| Method | Path | Description |
|--------|------|-------------|
| POST | `/cases/closed` | Salesforce outbound message webhook (SOAP/XML). Fires when a case is closed. |

### Chats

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chats/new` | New chat event (stub). |
| POST | `/chats/notify` | Chat notification (stub). |

### Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard/{DASHBOARD_KEY}/api` | Returns real-time dashboard data: agents, queue, stats, and call lists. |

The dashboard UI is served as static files at `/dashboard/{DASHBOARD_KEY}` and updates in real-time via WebSocket.

## Postman Collection

Import `RCS_Postman_Collection.json` into Postman for a full set of test requests, including end-to-end flow sequences (happy path inbound call, abandoned call, callback request).

## Project Structure

```
src/
  index.js              # Express server setup, middleware, route registration
  controllers/
    calls.js            # Call lifecycle handlers (ringing, answer, end)
    queue.js            # Queue handlers (new, callback, end)
    statuses.js         # Agent status change handler
    cases.js            # Salesforce case closed webhook
    dashboard.js        # Dashboard API endpoint
  helpers/
    sfdc_functions.js   # Salesforce integration (case creation, lookups)
    wrapup_timers.js    # Post-call wrap-up timer management
  AVA/                  # AVA service integration
public/                 # Dashboard static files (HTML/CSS/JS)
LOGS/                   # Application logs
```
