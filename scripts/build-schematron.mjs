// Builds the e-invoicing validators the UBL conformance test runs against.
//
// Both rulesets are XSLT 2.0, which Node cannot execute, so each is compiled to
// a SaxonJS SEF bundle. Only the SOURCES are committed; every artefact this
// script writes is gitignored, so a fresh checkout runs `npm run build:schematron`
// once (about 20 seconds) and the conformance suite stops skipping.
//
// The two rulesets arrive in different shapes:
//
//   EN 16931 (CEN)  — upstream publishes a pre-compiled .xslt, so we vendor that
//                     directly and only need the SEF export.
//   Peppol BIS 3.0  — upstream publishes .sch only, so we run the standard
//                     three-stage ISO Schematron pipeline over it first. That
//                     also means any other .sch (a Peppol update, or a national
//                     CIUS such as XRechnung) can be built here without hunting
//                     for someone else's pre-built artefact.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = resolve(import.meta.dirname, '../external/schematron')
const ISO = join(DIR, 'iso')
// Invoke SaxonJS's CLI through node directly rather than via npx + a shell:
// paths here can contain spaces, and shell interpolation would mangle them.
const XSLT3 = resolve(import.meta.dirname, '../node_modules/xslt3/xslt3.js')

const xslt3 = (args) => execFileSync(globalThis.process.execPath, [XSLT3, ...args], {
  stdio: ['ignore', 'ignore', 'inherit'],
})

const exportSef = (stylesheet, sef) => {
  xslt3([`-xsl:${stylesheet}`, `-export:${sef}`, '-nogo'])
  console.log(`  → ${sef}`)
}

// iso_dsdl_include (resolve inclusions) → iso_abstract_expand (expand abstract
// patterns) → iso_svrl_for_xslt2 (emit an SVRL-producing stylesheet).
function compileSchematron(sch, out) {
  const work = mkdtempSync(join(tmpdir(), 'sch-'))
  try {
    const stage1 = join(work, 'included.sch')
    const stage2 = join(work, 'expanded.sch')
    xslt3([`-xsl:${join(ISO, 'iso_dsdl_include.xsl')}`, `-s:${sch}`, `-o:${stage1}`])
    xslt3([`-xsl:${join(ISO, 'iso_abstract_expand.xsl')}`, `-s:${stage1}`, `-o:${stage2}`])
    xslt3([`-xsl:${join(ISO, 'iso_svrl_for_xslt2.xsl')}`, `-s:${stage2}`, `-o:${out}`])
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

console.log('EN 16931 (CEN) — vendored pre-compiled, exporting SEF')
exportSef(join(DIR, 'EN16931-UBL-validation.xslt'), join(DIR, 'EN16931-UBL-validation.sef.json'))

console.log('Peppol BIS Billing 3.0 — compiling Schematron, then exporting SEF')
compileSchematron(join(DIR, 'PEPPOL-EN16931-UBL.sch'), join(DIR, 'PEPPOL-EN16931-UBL.xslt'))
exportSef(join(DIR, 'PEPPOL-EN16931-UBL.xslt'), join(DIR, 'PEPPOL-EN16931-UBL.sef.json'))

console.log('done')
