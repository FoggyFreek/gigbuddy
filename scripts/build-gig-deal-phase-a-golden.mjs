import { writeFile } from 'node:fs/promises'
import { buildGigDealGoldenCases } from '../src/planning/gigs/__tests__/gigDealGoldenCases.js'

const target = new URL('../src/planning/gigs/__tests__/fixtures/gigDealPhaseA.golden.json', import.meta.url)
await writeFile(target, `${JSON.stringify(buildGigDealGoldenCases(), null, 2)}\n`, 'utf8')
