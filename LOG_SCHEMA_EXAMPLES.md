# Log Schema Before & After Examples

## Example 1: Call Answered Successfully

### Before
```javascript
const answerLog = {
  messageId,
  event: 'CALL ANSWERED',
  ani: body.ani,
};
logger.info({ ...answerLog, subEvent: 'CASE CREATED', caseRecord });
```

**Output:**
```json
{
  "messageId": "MSG123",
  "event": "CALL ANSWERED",
  "ani": "5551234567",
  "subEvent": "CASE CREATED",
  "caseRecord": { "id": "500...", "CaseNumber": "00001234", "Subject": "...", ... }
}
```

**Issues:**
- Mixed naming: `event` vs `subEvent`
- Full caseRecord object clutters the log
- Hard to query: is this calls or cases domain?
- No user context

### After
```javascript
logger.info(createCallLog({
  operation: 'answer',
  subOperation: 'CASE_CREATED',
  messageId,
  ani: body.ani,
  userId: body.alulaUser.id,
  caseId: caseRecord.id,
  data: {
    caseNumber: caseRecord.CaseNumber,
    subject: caseRecord.Subject
  }
}));
```

**Output:**
```json
{
  "domain": "calls",
  "operation": "answer",
  "subOperation": "CASE_CREATED",
  "correlationId": "MSG123",
  "ani": "5551234567",
  "userId": 42,
  "caseId": "500ABC123",
  "metadata": {
    "caseNumber": "00001234",
    "subject": "Tech Support Call"
  }
}
```

**Benefits:**
- ✅ Clear domain and operation
- ✅ Important fields at top level (easy to query)
- ✅ Minimal, relevant data only
- ✅ User context included

---

## Example 2: Error Handling

### Before
```javascript
catch (error) {
  logger.error({ ...answerLog, error });
}
```

**Output:**
```json
{
  "messageId": "MSG123",
  "event": "CALL ANSWERED",
  "ani": "5551234567",
  "error": {
    "_original": { /* huge object */ },
    "details": [ /* array */ ]
  }
}
```

**Issues:**
- Error object can be huge and unstructured
- Missing critical context (what operation failed?)
- No consistent error format

### After
```javascript
catch (error) {
  logger.error({
    ...createCallLog({
      operation: 'answer',
      subOperation: 'CASE_CREATION_FAILED',
      messageId,
      ani: body.ani,
      userId: body.alulaUser?.id
    }),
    ...formatError(error)
  });
}
```

**Output:**
```json
{
  "domain": "calls",
  "operation": "answer",
  "subOperation": "CASE_CREATION_FAILED",
  "correlationId": "MSG123",
  "ani": "5551234567",
  "userId": 42,
  "error": {
    "message": "Connection timeout",
    "name": "SalesforceError",
    "code": "ECONNRESET",
    "stack": "Error: Connection timeout\n    at ..."
  }
}
```

**Benefits:**
- ✅ Clean, structured error info
- ✅ Clear what operation failed
- ✅ All context preserved
- ✅ Searchable by error type

---

## Example 3: Queue Operations

### Before
```javascript
// In controller
logger.info(req.body);

// In AVA module
logger.info({ results: results.data }, 'Queue added');
```

**Output (Controller):**
```json
{
  "caller_number": "5551234567",
  "call_result": "ANSWERED",
  "recording_url": "https://...",
  "event_type": "queue",
  "timestamp": "...",
  /* ...20 more fields... */
}
```

**Output (AVA Module):**
```json
{
  "results": {
    "status": "success",
    "queue_position": 3
  },
  "msg": "Queue added"
}
```

**Issues:**
- Controller logs entire body (too much noise)
- Two separate logs for same operation
- No correlation between them
- Inconsistent structure

### After
```javascript
// In controller
logger.info(createQueueLog({
  operation: 'add',
  callerNumber: body.caller_number,
  messageId: req.messageId,
  data: {
    callResult: body.call_result,
    hasRecording: body.recording_url.length > 0
  }
}));

// In AVA module
logger.info(createQueueLog({
  operation: 'add',
  callerNumber,
  data: {
    avaResponse: results.data,
    queuePosition: results.data.queue_position
  }
}));
```

**Output (Both):**
```json
{
  "domain": "queue",
  "operation": "add",
  "callerNumber": "5551234567",
  "correlationId": "MSG123",
  "metadata": {
    "callResult": "ANSWERED",
    "hasRecording": true,
    "queuePosition": 3
  }
}
```

**Benefits:**
- ✅ Minimal, relevant data
- ✅ Same structure in both places
- ✅ Easy to correlate by callerNumber or correlationId
- ✅ Searchable by operation

---

## Example 4: Tracing a Complete Call Flow

### Before
Searching logs for message MSG123:

```bash
$ cat LOGS.json | jq 'select(.messageId == "MSG123")'
```

Results in mixed formats:
```json
{"messageId":"MSG123","event":"CALL ANSWERED","ani":"555..."}
{"messageId":"MSG123","event":"CALL ANSWERED","subEvent":"CASE CREATED","caseRecord":{...}}
{"body":{"ani":"555..."},"event":"status update"}
{"messageId":"MSG123","event":"CALL ENDED","ani":"555..."}
```

**Issues:**
- Inconsistent formats make parsing difficult
- Some logs missing messageId
- Hard to tell the story of what happened

### After
```bash
$ cat LOGS.json | jq 'select(.correlationId == "MSG123")' | jq -s 'sort_by(.time)'
```

Results in consistent format:
```json
[
  {
    "time": "2026-02-11T10:00:00Z",
    "domain": "queue",
    "operation": "add",
    "correlationId": "MSG123",
    "callerNumber": "5551234567"
  },
  {
    "time": "2026-02-11T10:00:30Z",
    "domain": "calls",
    "operation": "answer",
    "correlationId": "MSG123",
    "ani": "5551234567",
    "userId": 42
  },
  {
    "time": "2026-02-11T10:00:32Z",
    "domain": "calls",
    "operation": "answer",
    "subOperation": "CASE_CREATED",
    "correlationId": "MSG123",
    "ani": "5551234567",
    "caseId": "500ABC123"
  },
  {
    "time": "2026-02-11T10:05:00Z",
    "domain": "calls",
    "operation": "end",
    "correlationId": "MSG123",
    "ani": "5551234567",
    "callRecordId": "123",
    "metadata": { "duration": 270 }
  },
  {
    "time": "2026-02-11T10:05:01Z",
    "domain": "queue",
    "operation": "remove",
    "correlationId": "MSG123",
    "callerNumber": "5551234567"
  }
]
```

**Benefits:**
- ✅ Complete story of the call
- ✅ Easy to see progression through system
- ✅ Can identify bottlenecks (time between operations)
- ✅ Consistent structure makes parsing trivial

---

## Useful Queries

```bash
# All failed operations
cat LOGS.json | jq 'select(.error != null)'

# All operations for a specific user
cat LOGS.json | jq 'select(.userId == 42)'

# All queue operations today
cat LOGS_QUEUE.json | jq 'select(.time | startswith("2026-02-11"))'

# Count operations by type
cat LOGS_CALLS.json | jq -r '.operation' | sort | uniq -c

# Find slow calls (duration > 5 minutes)
cat LOGS_CALLS.json | jq 'select(.metadata.duration > 300)'

# Trace all operations for ANI
cat LOGS.json | jq 'select(.ani == "5551234567" or .callerNumber == "5551234567")'

# All case creation failures
cat LOGS_CALLS.json | jq 'select(.subOperation == "CASE_CREATION_FAILED")'
```
