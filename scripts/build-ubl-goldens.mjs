// Regenerates the UBL golden fixtures — and refuses to write one that is not
// conformant.
//
// The goldens are byte-compared by src/tests/renderInvoiceUbl.test.js, so any
// change to the renderer (or to anything upstream of it) fails that suite until
// they are regenerated. That moment is the one point at which a non-conformant
// document could quietly become the new expected output, so validation belongs
// here rather than in CI: every case is rendered and checked against BOTH
// official rulesets, and nothing is written unless all of them pass.
//
// Expected Peppol failures are declared in the fixtures module. They exist
// because we deliberately emit documents an access point would reject rather
// than refusing the download — see EXPECTED_PEPPOL_FAILURES.
//
// Usage:  npm run build:ubl-goldens        (needs npm run build:schematron first)
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderInvoiceUbl } from '../server/utils/renderInvoiceUbl.js'
import { CASES, EXPECTED_PEPPOL_FAILURES } from '../src/tests/fixtures/ubl/cases.js'
import {
  describeFailures,
  schematronAvailable,
  validateEn16931,
  validatePeppol,
} from '../src/tests/fixtures/ubl/validator.js'

const OUT_DIR = resolve(import.meta.dirname, '../src/tests/fixtures/ubl')

if (!schematronAvailable()) {
  console.error('Schematron artefacts missing. Run `npm run build:schematron` first.')
  globalThis.process.exit(1)
}

// Render and check everything before writing anything, so a failure never leaves
// the fixtures half-updated.
const rendered = []
const problems = []

for (const [name, input] of Object.entries(CASES)) {
  const xml = renderInvoiceUbl(input)

  const cen = validateEn16931(xml)
  if (cen.length > 0) {
    problems.push(`${name} — EN 16931:\n    ${describeFailures(cen).join('\n    ')}`)
  }

  const expected = [...(EXPECTED_PEPPOL_FAILURES[name] ?? [])].sort()
  const actual = validatePeppol(xml).map((f) => f.id).sort()
  if (actual.join() !== expected.join()) {
    const unexpected = actual.filter((id) => !expected.includes(id))
    const missing = expected.filter((id) => !actual.includes(id))
    problems.push([
      `${name} — Peppol:`,
      unexpected.length > 0 ? `    unexpected: ${unexpected.join(', ')}` : null,
      // A declared failure that stopped happening is good news, but the
      // declaration is now a lie and should be removed.
      missing.length > 0 ? `    no longer failing (drop from EXPECTED_PEPPOL_FAILURES): ${missing.join(', ')}` : null,
    ].filter(Boolean).join('\n'))
  }

  rendered.push([name, xml, expected])
}

if (problems.length > 0) {
  console.error('Refusing to write goldens — not conformant:\n')
  for (const problem of problems) console.error(`  ${problem}\n`)
  globalThis.process.exit(1)
}

for (const [name, xml, expected] of rendered) {
  writeFileSync(resolve(OUT_DIR, `${name}.xml`), xml)
  const note = expected.length > 0 ? `  (expected Peppol: ${expected.join(', ')})` : ''
  console.log(`  ${name}.xml${note}`)
}
console.log(`\n${rendered.length} goldens written, all conformant.`)
