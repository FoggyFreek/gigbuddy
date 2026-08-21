import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { buildGigDealGoldenCases } from './gigDealGoldenCases.js'

const fixturePath = resolve(cwd(), 'src/planning/gigs/__tests__/fixtures/gigDealPhaseA.golden.json')

describe('gig deal Phase A behavior golden', () => {
  it('preserves every legacy statement, simulation and invoice-line result byte-for-byte', async () => {
    // The large fixture is generated locally by test:gig-deal-phase-a and is intentionally not committed.
    const golden = JSON.parse(await readFile(fixturePath, 'utf8'))
    expect(JSON.stringify(buildGigDealGoldenCases())).toBe(JSON.stringify(golden))
  })
})
