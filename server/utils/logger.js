import { getStore } from './requestContextStore.js'

const LOG_LEVELS = ['debug', 'info', 'warn', 'error']

// Extending this set is the intended, reviewable way to add a new loggable
// field — deliberately not a generic passthrough. Never add a free-text
// "message" key here: route diagnostic text through the `err` shorthand
// instead, which is redacted to name/code/status and never serializes the
// original message (see logger.error's `err` handling).
const CONTEXT_KEYS = new Set([
  'tenantId', 'invoiceId', 'userId', 'gigId', 'taskId', 'rehearsalId',
  'operation', 'status', 'method', 'path', 'durationMs', 'endpointHost',
  'mode', 'migrated', 'reEncrypted', 'plaintextRemaining', 'port',
  'filename', 'aborted',
  'tenants', 'plaintext', 'encrypted', 'conflicts', 'corrupt',
  'migrationNeeded', 'reEncryptionNeeded',
  'subscriptionId', 'planId', 'planSlug', 'paymentKind', 'mollieStatus',
  'jobName', 'feature', 'ownerUserId', 'opType', 'revokedTokens',
  'achievementKey',
])

function safeCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : null
}

function isPrimitive(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function sanitizeFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => CONTEXT_KEYS.has(key) && isPrimitive(value)),
  )
}

// Deliberately never includes err.message or err.stack, in any environment
function redactErr(err) {
  return {
    errorName: safeCode(err?.name) || 'Error',
    errorCode: safeCode(err?.code),
    errorStatus: Number.isInteger(err?.statusCode) ? err.statusCode
      : Number.isInteger(err?.status) ? err.status : null,
  }
}

function alsEnrichment() {
  const store = getStore()
  if (!store) return {}
  return Object.fromEntries(
    ['requestId', 'tenantId', 'userId']
      .filter((key) => isPrimitive(store[key]))
      .map((key) => [key, store[key]]),
  )
}

function currentLevelIndex() {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase()
  const idx = LOG_LEVELS.indexOf(raw)
  return idx === -1 ? LOG_LEVELS.indexOf('info') : idx
}

function levelEnabled(level) {
  return LOG_LEVELS.indexOf(level) >= currentLevelIndex()
}

function write(level, event, fields = {}) {
  if (!levelEnabled(level)) return
  const { err, ...rest } = fields
  const line = {
    ts: new Date().toISOString(),
    level,
    event: safeCode(event) || 'application.error',
    ...sanitizeFields(rest),
    ...alsEnrichment(),
    ...(err ? redactErr(err) : {}),
  }
  const sink = level === 'debug' || level === 'info' ? console.log : console.error
  sink(JSON.stringify(line))
}

export const logger = {
  debug: (event, fields = {}) => write('debug', event, fields),
  info: (event, fields = {}) => write('info', event, fields),
  warn: (event, fields = {}) => write('warn', event, fields),
  error: (event, fields = {}) => write('error', event, fields),
}
