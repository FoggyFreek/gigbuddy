// A tiny in-process concurrency limiter: caps total in-flight operations and
// per-key (per-tenant) in-flight operations. Used to bound the unfurl
// endpoint's fan-out so a tenant admin can't launch many simultaneous remote
// fetches (each already byte- and time-bounded) and multiply memory/socket
// pressure. Single-process only — the linkpage app runs as one process.
export function createConcurrencyGate({ max, maxPerKey }) {
  let total = 0
  const perKey = new Map()

  return {
    // Reserves a slot for `key`; returns false (caller should 429) when either
    // the global or the per-key ceiling is already reached.
    tryAcquire(key) {
      const current = perKey.get(key) || 0
      if (total >= max || current >= maxPerKey) return false
      total += 1
      perKey.set(key, current + 1)
      return true
    },
    release(key) {
      total = Math.max(0, total - 1)
      const next = (perKey.get(key) || 1) - 1
      if (next <= 0) perKey.delete(key)
      else perKey.set(key, next)
    },
    get inFlight() {
      return total
    },
  }
}
