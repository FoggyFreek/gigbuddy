// SSRF-hardened HTTP(S) text fetch for the editor unfurl feature. The only
// place this app fetches a URL supplied by a user (an authenticated tenant
// admin), so it must not become a probe into internal services or cloud
// metadata endpoints (e.g. 169.254.169.254).
//
// Three layers of defense, matching the recommended fix:
//   1. assertPublicUrl — scheme/port/credentials/IP-literal pre-check.
//   2. Connection-time pinning — a custom DNS lookup validates EVERY resolved
//      address and net.connect uses exactly the address we validated, so a
//      hostname that resolves to a private IP (or a DNS-rebinding race) can
//      never establish the socket. This is the load-bearing control; the
//      string checks are only a fast path.
//   3. Manual redirect handling — redirects are never auto-followed; each hop
//      is re-validated by re-entering the same checks before we connect.
//
// TLS stays correct: we connect by hostname (SNI/cert use the hostname) while
// net resolves through our validated lookup, so pinning does not weaken HTTPS.
//
// Operators who prefer network-level enforcement can additionally route this
// process's egress through a public-internet-only proxy; these code controls
// hold regardless.
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import ipaddr from 'ipaddr.js'

const FETCH_TIMEOUT_MS = 5000
const MAX_BYTES = 600 * 1024
const MAX_REDIRECTS = 5
// Only standard web ports; arbitrary ports are how SSRF probes internal
// services. '' means the URL used the scheme default (80/443).
const ALLOWED_PORTS = new Set(['', '80', '443'])

// A parsed address is safe only if it is a normal public unicast address.
// ipaddr.js classifies every reserved range (private, loopback, link-local,
// unique-local, multicast, reserved, carrier-grade NAT, 6to4/teredo, …) as
// something other than 'unicast'. IPv4-mapped IPv6 (::ffff:a.b.c.d) is
// unwrapped first so it is judged by its embedded IPv4 range.
export function isPublicAddress(ip) {
  let addr
  try {
    addr = ipaddr.parse(ip)
  } catch {
    return false
  }
  if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
    addr = addr.toIPv4Address()
  }
  return addr.range() === 'unicast'
}

// Synchronous pre-check. Throws with a stable message on anything we refuse to
// fetch. Not the sole defense (a hostname's DNS result is checked at connect
// time) but fails fast and blocks IP literals without a DNS round-trip.
export function assertPublicUrl(url) {
  const u = url instanceof URL ? url : new URL(url)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('unsupported scheme')
  }
  // Embedded credentials (user:pass@host) are a classic SSRF/parsing trick.
  if (u.username || u.password) throw new Error('credentials not allowed')
  if (!ALLOWED_PORTS.has(u.port)) throw new Error('port not allowed')

  const host = u.hostname.toLowerCase()
  if (!host) throw new Error('missing host')
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('internal host')
  }
  // If the host is an IP literal, validate it now. Bracketed IPv6 hostnames
  // arrive without brackets from the URL parser.
  const literal = host.startsWith('[') ? host.slice(1, -1) : host
  if (ipaddr.isValid(literal) && !isPublicAddress(literal)) {
    throw new Error('non-public address')
  }
  return u
}

// A net.connect-compatible lookup that resolves the hostname, rejects the
// connection if ANY resolved address is non-public, and otherwise returns the
// validated addresses for net to connect to. Because net uses exactly what we
// return, the IP that gets connected is the IP we validated — closing the
// DNS-to-private and DNS-rebinding gaps.
export function pinnedLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err)
    const blocked = addresses.find((a) => !isPublicAddress(a.address))
    if (blocked) return callback(new Error(`blocked non-public address ${blocked.address}`))
    if (options && options.all) return callback(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}

// Performs ONE request (no redirect following) with the pinned lookup, a hard
// timeout, and a response-size cap. Resolves { status, location, body }.
function performRequest(url, accept) {
  const client = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'GET',
        headers: { accept, 'user-agent': 'gigbuddy-linkpage/1.0 (+link page editor unfurl)' },
        lookup: pinnedLookup,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
      (res) => {
        const status = res.statusCode || 0
        // Redirect: hand the target back to the loop without reading the body.
        if (status >= 300 && status < 400 && res.headers.location) {
          res.destroy()
          resolve({ status, location: res.headers.location, body: '' })
          return
        }
        res.setEncoding('utf8')
        let body = ''
        res.on('data', (chunk) => {
          body += chunk
          if (body.length > MAX_BYTES) {
            body = body.slice(0, MAX_BYTES)
            res.destroy()
            resolve({ status, location: null, body })
          }
        })
        res.on('end', () => resolve({ status, location: null, body }))
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

// SSRF-safe text fetch that follows redirects manually, re-validating every
// hop. `transport` is injectable for tests. Throws on any non-public hop, a
// 4xx/5xx, or too many redirects.
export async function safeFetchText(rawUrl, accept, { transport = performRequest, maxRedirects = MAX_REDIRECTS } = {}) {
  let url = assertPublicUrl(rawUrl)
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await transport(url, accept)
    if (res.status >= 300 && res.status < 400 && res.location) {
      // Re-validate the redirect target before the next connect.
      url = assertPublicUrl(new URL(res.location, url))
      continue
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`fetch failed with ${res.status}`)
    }
    return res.body
  }
  throw new Error('too many redirects')
}
