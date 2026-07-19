import { describe, it, expect } from 'vitest'
import { createConcurrencyGate } from '../server/concurrencyGate.js'

describe('createConcurrencyGate', () => {
  it('enforces the global ceiling', () => {
    const gate = createConcurrencyGate({ max: 2, maxPerKey: 5 })
    expect(gate.tryAcquire('a')).toBe(true)
    expect(gate.tryAcquire('b')).toBe(true)
    expect(gate.tryAcquire('c')).toBe(false) // global full
    gate.release('a')
    expect(gate.tryAcquire('c')).toBe(true) // slot freed
  })

  it('enforces the per-key ceiling independently of the global one', () => {
    const gate = createConcurrencyGate({ max: 10, maxPerKey: 2 })
    expect(gate.tryAcquire('t1')).toBe(true)
    expect(gate.tryAcquire('t1')).toBe(true)
    expect(gate.tryAcquire('t1')).toBe(false) // t1 saturated
    expect(gate.tryAcquire('t2')).toBe(true) // other key unaffected
    gate.release('t1')
    expect(gate.tryAcquire('t1')).toBe(true)
  })

  it('tracks in-flight count and never goes negative on over-release', () => {
    const gate = createConcurrencyGate({ max: 3, maxPerKey: 3 })
    gate.tryAcquire('a')
    expect(gate.inFlight).toBe(1)
    gate.release('a')
    gate.release('a') // extra release is a no-op
    expect(gate.inFlight).toBe(0)
    expect(gate.tryAcquire('a')).toBe(true)
  })
})
