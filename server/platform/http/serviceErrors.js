// Expected service failures use one result shape so routes can translate them
// consistently with sendError(): { error: { status, body } }.
export function serviceError(status, message, details = {}) {
  return { error: { status, body: { error: message, ...details } } }
}

export function badRequest(message, details) {
  return serviceError(400, message, details)
}

export function forbidden(message, details) {
  return serviceError(403, message, details)
}

export function notFound(message, details) {
  return serviceError(404, message, details)
}

export function conflict(message, details) {
  return serviceError(409, message, details)
}

// A surface reached in a tenant of the wrong kind — a band roster in a
// musician's personal workspace, say. 403, not 404: the caller is a member and
// knows the kind, so nothing is concealed. Route gates and service guards use
// this same structured response.
export function tenantKindNotSupported(kind) {
  return forbidden('This feature is not available in this workspace', {
    code: 'tenant_kind_not_supported',
    kind: kind ?? null,
  })
}
