/**
 * Standard Log Schema for RCS Application
 *
 * This module provides helper functions to create consistent, structured logs
 * across all domains (calls, cases, chats, queue, statuses).
 *
 * CORE PRINCIPLES:
 * 1. Every log should have base fields (operation, domain, etc.)
 * 2. Use consistent naming conventions
 * 3. Include correlation IDs for tracing across services
 * 4. Separate business data from metadata
 * 5. Make logs searchable and filterable
 */

/**
 * Creates a standardized log entry with base fields
 *
 * @param {Object} params - Log parameters
 * @param {string} params.domain - Domain/module (calls, cases, chats, queue, statuses)
 * @param {string} params.operation - What operation is being performed (answer, end, create, update, etc.)
 * @param {string} [params.subOperation] - More specific operation detail
 * @param {string} [params.correlationId] - ID to trace related operations (messageId, callId, etc.)
 * @param {Object} [params.context] - Domain-specific context (ani, userId, caseId, etc.)
 * @param {Object} [params.metadata] - Additional metadata that doesn't fit elsewhere
 * @returns {Object} Structured log object
 */
const createLogEntry = ({
  domain,
  operation,
  subOperation,
  correlationId,
  context = {},
  metadata = {},
}) => {
  const entry = {
    domain,
    operation,
  };

  if (subOperation) entry.subOperation = subOperation;
  if (correlationId) entry.correlationId = correlationId;

  // Add context fields at top level for easier querying
  if (Object.keys(context).length > 0) {
    Object.assign(entry, context);
  }

  // Add metadata if present
  if (Object.keys(metadata).length > 0) {
    entry.metadata = metadata;
  }

  return entry;
};

/**
 * Creates a log entry for call-related operations
 *
 * @param {Object} params
 * @param {string} params.operation - Operation type (answer, end, create, update)
 * @param {string} [params.subOperation] - Sub-operation (CASE_CREATED, CALL_RECORD_CREATED, etc.)
 * @param {string} params.messageId - Five9 message ID for correlation
 * @param {string} params.ani - Caller's phone number
 * @param {string} [params.callId] - RingCentral call ID
 * @param {number} [params.userId] - Alula user ID
 * @param {string} [params.callerName] - Caller's name if known
 * @param {string} [params.caseId] - Salesforce case ID if applicable
 * @param {string} [params.callRecordId] - ATP call record ID if applicable
 * @param {Object} [params.data] - Additional data (results, records, etc.)
 * @returns {Object} Structured call log
 */
const createCallLog = ({
  operation,
  subOperation,
  messageId,
  ani,
  callId,
  userId,
  callerName,
  caseId,
  callRecordId,
  data = {},
}) => {
  return createLogEntry({
    domain: 'calls',
    operation,
    subOperation,
    correlationId: messageId,
    context: {
      ani,
      ...(callId && { callId }),
      ...(userId && { userId }),
      ...(callerName && { callerName }),
      ...(caseId && { caseId }),
      ...(callRecordId && { callRecordId }),
    },
    metadata: data,
  });
};

/**
 * Creates a log entry for case-related operations
 *
 * @param {Object} params
 * @param {string} params.operation - Operation type (create, update, close, pop)
 * @param {string} [params.subOperation] - Sub-operation detail
 * @param {string} [params.messageId] - Correlation ID
 * @param {string} [params.caseId] - Salesforce case ID
 * @param {string} [params.caseNumber] - Salesforce case number
 * @param {string} [params.ani] - Related phone number
 * @param {Object} [params.data] - Additional data
 * @returns {Object} Structured case log
 */
const createCaseLog = ({
  operation,
  subOperation,
  messageId,
  caseId,
  caseNumber,
  ani,
  data = {},
}) => {
  return createLogEntry({
    domain: 'cases',
    operation,
    subOperation,
    correlationId: messageId,
    context: {
      ...(caseId && { caseId }),
      ...(caseNumber && { caseNumber }),
      ...(ani && { ani }),
    },
    metadata: data,
  });
};

/**
 * Creates a log entry for queue operations
 *
 * @param {Object} params
 * @param {string} params.operation - Operation type (add, remove, callback)
 * @param {string} [params.subOperation] - Sub-operation detail
 * @param {string} [params.callerNumber] - Phone number in queue
 * @param {string} [params.messageId] - Correlation ID
 * @param {string} [params.callId] - RingCentral call ID
 * @param {string} [params.callRecordId] - ATP call record ID if applicable
 * @param {string} [params.caseId] - Salesforce case ID if applicable
 * @param {Object} [params.data] - Additional data (AVA response, etc.)
 * @returns {Object} Structured queue log
 */
const createQueueLog = ({ operation, subOperation, callerNumber, messageId, callId, callRecordId, caseId, data = {} }) => {
  return createLogEntry({
    domain: 'queue',
    operation,
    subOperation,
    correlationId: messageId,
    context: {
      ...(callerNumber && { callerNumber }),
      ...(callId && { callId }),
      ...(callRecordId && { callRecordId }),
      ...(caseId && { caseId }),
    },
    metadata: data,
  });
};

/**
 * Creates a log entry for status updates
 *
 * @param {Object} params
 * @param {string} params.operation - Operation type (update, change)
 * @param {string} [params.messageId] - Correlation ID
 * @param {string} [params.userId] - Alula user ID
 * @param {string} [params.slackId] - Slack user ID
 * @param {string} [params.status] - New status value
 * @param {string} [params.previousStatus] - Previous status value
 * @param {Object} [params.data] - Additional data
 * @returns {Object} Structured status log
 */
const createStatusLog = ({
  operation,
  messageId,
  userId,
  slackId,
  status,
  previousStatus,
  data = {},
}) => {
  return createLogEntry({
    domain: 'statuses',
    operation,
    correlationId: messageId,
    context: {
      ...(userId && { userId }),
      ...(slackId && { slackId }),
      ...(status && { status }),
      ...(previousStatus && { previousStatus }),
    },
    metadata: data,
  });
};

/**
 * Creates a log entry for chat operations
 *
 * @param {Object} params
 * @param {string} params.operation - Operation type (new, end, message)
 * @param {string} [params.chatId] - Chat identifier
 * @param {string} [params.userId] - User identifier
 * @param {Object} [params.data] - Additional data
 * @returns {Object} Structured chat log
 */
const createChatLog = ({ operation, chatId, userId, data = {} }) => {
  return createLogEntry({
    domain: 'chats',
    operation,
    context: {
      ...(chatId && { chatId }),
      ...(userId && { userId }),
    },
    metadata: data,
  });
};

/**
 * Creates a log entry for application/system-level operations
 *
 * @param {Object} params
 * @param {string} params.operation - Operation type (startup, shutdown, middleware, etc.)
 * @param {string} [params.subOperation] - Sub-operation detail
 * @param {string} [params.messageId] - Correlation ID if applicable
 * @param {Object} [params.data] - Additional data
 * @returns {Object} Structured app log
 */
const createAppLog = ({ operation, subOperation, messageId, data = {} }) => {
  return createLogEntry({
    domain: 'app',
    operation,
    subOperation,
    correlationId: messageId,
    metadata: data,
  });
};

/**
 * Wraps an error object with consistent structure
 *
 * @param {Error} error - The error object
 * @param {Object} [context] - Additional context about where/why the error occurred
 * @returns {Object} Structured error object for logging
 */
const formatError = (error, context = {}) => {
  return {
    error: {
      message: error.message,
      name: error.name,
      stack: error.stack,
      ...(error.code && { code: error.code }),
    },
    ...context,
  };
};

module.exports = {
  createLogEntry,
  createCallLog,
  createCaseLog,
  createQueueLog,
  createStatusLog,
  createChatLog,
  createAppLog,
  formatError,
};
