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
