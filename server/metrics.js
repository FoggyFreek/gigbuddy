import client from 'prom-client'

// Application metrics for Prometheus/Grafana Cloud (scraped by Alloy at
// GET /metrics). A dedicated registry keeps our series isolated from any
// library that might poke prom-client's global default registry.
export const register = new client.Registry()

// Node runtime + process metrics (event-loop lag, heap, GC, fds, cpu, …).
client.collectDefaultMetrics({ register })

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests handled, by method, route template and status.',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
})

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds, by method, route template and status.',
  labelNames: ['method', 'route', 'status'],
  // Web-latency oriented buckets (seconds).
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
})

const httpRequestsInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'Number of HTTP requests currently being processed.',
  registers: [register],
})

// The label MUST stay bounded: a normalized route template ("/api/gigs/:id")
// or the constant "unmatched". Never the raw path — that embeds gig/user/tenant
// ids and would explode cardinality (and leak identifiers into metrics).
// Verified against Express 5: req.baseUrl + req.route.path resolve correctly
// inside the res 'finish' handler even though req.path does not.
function routeLabel(req) {
  return req.route ? `${req.baseUrl || ''}${req.route.path}` : 'unmatched'
}

// Instruments every request except the scrape endpoint itself (so a scrape
// never inflates the very counters it reads). Mounted at the top of the stack
// so it wraps the whole request lifecycle.
export function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics') {
    next()
    return
  }

  const endTimer = httpRequestDuration.startTimer()
  httpRequestsInFlight.inc()

  let recorded = false
  const record = () => {
    if (recorded) return
    recorded = true
    httpRequestsInFlight.dec()
    const labels = { method: req.method, route: routeLabel(req), status: String(res.statusCode) }
    httpRequestsTotal.inc(labels)
    endTimer(labels)
  }

  // 'finish' fires on a completed response; 'close' covers a client abort that
  // never finishes. The guard makes the pair idempotent (both fire normally).
  res.on('finish', record)
  res.on('close', record)

  next()
}

// GET /metrics — Prometheus exposition text. Deliberately unauthenticated:
// the app port is bound to 127.0.0.1 on the host and Alloy scrapes it over the
// internal Docker network; the public reverse proxy must not route /metrics.
export async function metricsHandler(_req, res) {
  res.set('Content-Type', register.contentType)
  res.end(await register.metrics())
}
