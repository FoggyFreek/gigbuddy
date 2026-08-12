import { parsePositiveId } from '../../validators/common.js'

// Parses the positive integer route-id convention shared by tenant resources.
// It keeps HTTP translation in the route layer while avoiding per-router
// copies of the same 400 response contract.
export function requireParam(req, res, name, options = {}) {
  const {
    parse = parsePositiveId,
    label = name,
    error = `Invalid ${label}`,
  } = options
  const id = parse(req.params[name])
  if (id === null) {
    res.status(400).json({ error })
    return null
  }
  return id
}

// Expected service failures use { status, body }; unexpected errors still flow
// to Express's global error middleware.
export function sendError(res, error) {
  res.status(error.status).json(error.body)
}

// Who is looking, and from which band's screen. Every read that projects a
// musician's availability takes this, because it decides how much of each
// linked member's entry is revealed (server/planning/availability/availabilityProjection.js).
export function viewerOf(req) {
  return { userId: req.user.id, tenantId: req.tenantId }
}
