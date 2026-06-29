const CONTEXT_KEYS = new Set(['tenantId', 'invoiceId', 'userId', 'operation', 'status'])

function safeCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : null
}

export function redactedErrorData(err) {
  return {
    errorName: safeCode(err?.name) || 'Error',
    errorCode: safeCode(err?.code),
    status: Number.isInteger(err?.statusCode) ? err.statusCode
      : Number.isInteger(err?.status) ? err.status : null,
  }
}

export function logError(event, err, context = {}) {
  const safeContext = Object.fromEntries(
    Object.entries(context).filter(([key]) => CONTEXT_KEYS.has(key)),
  )
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'error',
    event: safeCode(event) || 'application.error',
    ...redactedErrorData(err),
    ...safeContext,
  }))
}

