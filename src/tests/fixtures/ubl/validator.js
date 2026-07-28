// Runs the official e-invoicing Schematrons over a rendered UBL invoice and
// returns the failed assertions.
//
// Both rulesets are XSLT 2.0, which Node cannot execute directly, so each is
// compiled to a SaxonJS SEF bundle by `npm run build:schematron` and executed
// here through saxon-js. Sources live in external/schematron/; the compiled
// artefacts are generated, not committed.
//
// This is the ruleset our hand-written structural assertions can only
// approximate. Both defects found so far — UBL-SR-53 and UBL-CR-481 — passed the
// whole structural suite and were caught only here.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import SaxonJS from 'saxon-js'

const artefact = (name) => resolve(globalThis.process.cwd(), 'external/schematron', name)

/** EN 16931 — the CEN rules: BR-*, BR-CO-*, BR-S/Z/E/AE-*, UBL-SR-*, UBL-CR-*. */
export const EN16931_SEF = artefact('EN16931-UBL-validation.sef.json')
/** Peppol BIS Billing 3.0 — the network profile on top: PEPPOL-EN16931-R*, national rules. */
export const PEPPOL_SEF = artefact('PEPPOL-EN16931-UBL.sef.json')

/** False until `npm run build:schematron` has run; callers skip rather than fail. */
export const schematronAvailable = () => existsSync(EN16931_SEF) && existsSync(PEPPOL_SEF)

/** First capture group of `pattern`, or '' when it does not match. */
const capture = (pattern, source) => pattern.exec(source)?.[1] ?? ''

/** Version stamp of the vendored CEN ruleset, for the test report. */
export function schematronVersion() {
  const header = readFileSync(artefact('EN16931-UBL-validation.xslt'), 'utf8').slice(0, 400)
  return capture(/Schematron version ([\d.]+)/, header) || 'unknown'
}

const FAILED_ASSERT = /<svrl:failed-assert\b([^>]*)>([\s\S]*?)<\/svrl:failed-assert>/g
const attr = (source, name) => capture(new RegExp(`\\b${name}="([^"]*)"`), source)

function run(sef, xml) {
  const { principalResult } = SaxonJS.transform({
    stylesheetFileName: sef,
    sourceText: xml,
    destination: 'serialized',
  }, 'sync')

  const failures = []
  for (const match of principalResult.matchAll(FAILED_ASSERT)) {
    const [, attrs, body] = match
    failures.push({
      id: attr(attrs, 'id'),
      flag: attr(attrs, 'flag'),
      location: attr(attrs, 'location'),
      text: capture(/<svrl:text[^>]*>([\s\S]*?)<\/svrl:text>/, body).replaceAll(/\s+/g, ' ').trim(),
    })
  }
  return failures
}

/** @returns {{id,flag,location,text}[]} — empty when the document is conformant. */
export const validateEn16931 = (xml) => run(EN16931_SEF, xml)

/** @returns {{id,flag,location,text}[]} — empty when the document is Peppol-clean. */
export const validatePeppol = (xml) => run(PEPPOL_SEF, xml)

/** Compact one-line-per-failure summary, for assertion messages. */
export const describeFailures = (failures) =>
  failures.map((f) => `${f.id} [${f.flag}] ${f.text} @ ${f.location}`)
