# RCS Log Schema Guide

## Overview

This guide defines a standardized logging schema to make logs consistent, searchable, and easy to understand across the entire RCS application.

**IMPORTANT:** This schema only changes the **format/structure** of log entries. Your existing logger setup (`createLogger()`) still works exactly the same way - logs still go to both domain-specific files (LOGS_CALLS.json, LOGS_QUEUE.json, etc.) AND the general LOGS.json file.

## Core Principles

1. **Consistency**: Every log entry follows the same base structure
2. **Searchability**: Key fields are at the top level for easy filtering
3. **Traceability**: Correlation IDs link related operations
4. **Context-Rich**: Include relevant business context without noise
5. **Structured**: Use objects, not string concatenation

## How It Works With Your Existing Logger

Your logger configuration in `src/helpers/logger.js` already routes logs to multiple files:

```javascript
const logger = createLogger('queue');  // Creates a queue logger

logger.info(createQueueLog({ ... }));
```

This writes to:
- ✅ `LOGS_QUEUE.json` (domain-specific log)
- ✅ `LOGS.json` (general log - everything)
- ✅ `LOGS_ERRORS.json` (if it's an error)

**The schema doesn't change this routing - it just standardizes the format of what you write.**

### Example: One Log Entry, Multiple Files

```javascript
// In src/AVA/queue.js
const logger = createLogger('queue');
logger.info(createQueueLog({
  operation: 'add',
  callerNumber: '5551234567',
  data: { queuePosition: 3 }
}));
```

This single log entry appears in **both** files with the **same format**:

**LOGS_QUEUE.json:**
```json
{"level":"info","domain":"queue","operation":"add","callerNumber":"5551234567","metadata":{"queuePosition":3},"time":"2026-02-11T10:00:00Z"}
```

**LOGS.json:**
```json
{"level":"info","domain":"queue","operation":"add","callerNumber":"5551234567","metadata":{"queuePosition":3},"time":"2026-02-11T10:00:00Z"}
```

Now you can:
- Search LOGS_QUEUE.json for all queue operations
- Search LOGS.json to trace a call across all domains (queue → calls → cases)

## Base Schema

Every log entry should include:

```javascript
{
  domain: string,          // calls | cases | chats | queue | statuses
  operation: string,       // answer | end | create | update | add | remove, etc.
  subOperation?: string,   // More specific detail (CASE_CREATED, FIND_TECH, etc.)
  correlationId?: string,  // Trace ID (messageId, callId, caseId, etc.)

  // Context fields (domain-specific, at top level for easy querying)
  ani?: string,
  userId?: number,
  caseId?: string,
  // ... other relevant fields

  // Additional data that doesn't fit above
  metadata?: object
}
```

## Why This Schema?

### Before (Inconsistent)
```javascript
// Hard to search, inconsistent structure
logger.info(req.body);
logger.error({ error: error.message });
logger.info({ messageId, event: 'CALL ANSWERED', ani: body.ani });
```

### After (Consistent)
```javascript
// Easy to search by domain, operation, ANI, etc.
const log = createCallLog({
  operation: 'answer',
  subOperation: 'CASE_CREATED',
  messageId: req.messageId,
  ani: body.ani,
  userId: body.alulaUser.id,
  caseId: caseRecord.id,
  data: { caseNumber: caseRecord.CaseNumber }
});
logger.info(log);
```

## Usage Examples

### Calls Domain

```javascript
const { createCallLog, formatError } = require('../helpers/log_schema');

// Success case
logger.info(createCallLog({
  operation: 'answer',
  subOperation: 'CASE_CREATED',
  messageId: req.messageId,
  ani: body.ani,
  userId: body.alulaUser.id,
  caseId: caseRecord.id,
  data: { caseNumber: caseRecord.CaseNumber }
}));

// Error case
logger.error({
  ...createCallLog({
    operation: 'answer',
    subOperation: 'CASE_CREATION_FAILED',
    messageId: req.messageId,
    ani: body.ani,
  }),
  ...formatError(error)
});

// Call ended
logger.info(createCallLog({
  operation: 'end',
  messageId: req.messageId,
  ani: body.ani,
  userId: body.alulaUser.id,
  callRecordId: activeCallRecord.id,
  data: {
    duration: callDuration,
    recordingUrl: body.recording_url
  }
}));
```

### Queue Domain

```javascript
const { createQueueLog } = require('../helpers/log_schema');

// Queue added
logger.info(createQueueLog({
  operation: 'add',
  callerNumber: body.caller_number,
  messageId: req.messageId,
  data: { avaResponse: results.data }
}));

// Queue removed
logger.info(createQueueLog({
  operation: 'remove',
  callerNumber: body.caller_number,
  messageId: req.messageId,
  data: {
    reason: body.call_result,
    recordingPresent: body.recording_url.length > 0
  }
}));
```

### Cases Domain

```javascript
const { createCaseLog } = require('../helpers/log_schema');

logger.info(createCaseLog({
  operation: 'close',
  messageId: req.messageId,
  caseId: caseRecord.Id,
  caseNumber: caseRecord.CaseNumber,
  ani: tech.Technician_Phone__c,
  data: { callRecords }
}));
```

### Statuses Domain

```javascript
const { createStatusLog } = require('../helpers/log_schema');

logger.info(createStatusLog({
  operation: 'update',
  userId: user.id,
  slackId: user.slackId,
  status: body.event_aux_type,
  previousStatus: body.prev_aux_state,
  data: {
    statusText: statusMap[body.event_aux_type].statusText,
    emoji: statusMap[body.event_aux_type].statusEmoji
  }
}));
```

## Querying Your Logs

With this consistent schema, you can easily search logs:

```bash
# Find all logs for a specific ANI
cat LOGS_CALLS.json | jq 'select(.ani == "5551234567")'

# Find all queue operations
cat LOGS_QUEUE.json | jq 'select(.domain == "queue")'

# Find all errors for a specific message/call
cat LOGS_CALLS.json | jq 'select(.correlationId == "MSG123" and .level == "error")'

# Find all case creation operations
cat LOGS_CALLS.json | jq 'select(.subOperation == "CASE_CREATED")'

# Track a complete call flow by messageId
cat LOGS.json | jq 'select(.correlationId == "MSG123")' | jq -s 'sort_by(.time)'
```

## Migration Strategy

You don't need to migrate everything at once:

1. **Start with new code**: Use the schema for all new features
2. **Migrate gradually**: Update high-traffic endpoints first (calls, queue)
3. **Keep it simple**: If a log is already good enough, leave it
4. **Focus on errors**: Standardizing error logs has the highest impact

## Best Practices

### ✅ Do

- Use helper functions (`createCallLog`, etc.) for consistency
- Include correlation IDs (messageId) to trace operations
- Put queryable fields at top level (ani, userId, caseId)
- Use `subOperation` for specific steps in a larger operation
- Include relevant context without overwhelming detail

### ❌ Don't

- Log entire request objects (`logger.info(req)`)
- Use string concatenation for messages
- Nest important fields deep in metadata
- Log sensitive data (passwords, tokens, full credit cards)
- Create new domains without adding a helper function

## Error Logging Pattern

Always use `formatError` for consistent error logging:

```javascript
try {
  // ... operation
} catch (error) {
  logger.error({
    ...createCallLog({
      operation: 'answer',
      messageId: req.messageId,
      ani: body.ani
    }),
    ...formatError(error, {
      attemptedOperation: 'Creating Salesforce case',
      additionalContext: 'User was retry attempt'
    })
  });
}
```

## Log Levels

- **info**: Successful operations, state changes
- **warn**: Recoverable issues, fallback scenarios
- **error**: Failures, exceptions, data inconsistencies

## Benefits

1. **Faster Debugging**: Find related logs by correlationId
2. **Better Monitoring**: Query by operation, domain, or context
3. **Easier Onboarding**: New team members understand logs immediately
4. **Compliance**: Consistent audit trail
5. **Analytics**: Aggregate metrics by operation type
