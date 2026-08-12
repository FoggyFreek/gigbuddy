#!/usr/bin/env node
// PreToolUse hook: reminds Claude to load the relevant skill before editing a
// file whose area has its depth in a skill rather than in CLAUDE.md. CLAUDE.md
// keeps prohibitions; skills keep procedures, so this is the path-based half of
// the trigger (the prompt-keyword half is the skill's own description).
// Reads the hook payload on stdin, emits additionalContext for every matching
// rule, and stays silent when nothing matches.

const RULES = [
  {
    match: /\/src\/i18n\//,
    msg: 'This edits an i18n file. Load the i18n skill (Skill tool) before'
      + ' non-trivial translation work if you have not already this session.',
  },
  {
    match: /\/src\/.*\.tsx?$/,
    msg: 'This edits frontend TypeScript/React code. Load the react-frontend'
      + ' skill (Skill tool) — it owns the component, type, MUI and hook'
      + ' conventions that are no longer spelled out in CLAUDE.md.',
  },
  {
    match: /\/(server|src)\/finance\//,
    msg: 'This edits finance code. Load the finance-ledger skill (Skill tool)'
      + ' before changing ledger postings, invoices, VAT, the accounting'
      + ' profile, or bank import. postJournal() is the only ledger insert path'
      + ' and entries are never edited or deleted.',
  },
  {
    match: /availability/i,
    msg: 'This edits availability code. Load the availability skill (Skill'
      + ' tool): slots are user-level, and every band-side read goes through the'
      + ' redacted projection before serialization.',
  },
  {
    match: /(meService|memberTenants|band-profiles|bandProfile|my-bands|myBand|tenantCapabilities|usePlanningSource|usePagedEventTabs|useCrossTenantRow)/,
    msg: 'This edits tenant-kind or cross-tenant code. Load the tenant-model'
      + ' skill (Skill tool) for the /api/me hub rules, the band-profile lock'
      + ' order, and the capability registry.',
  },
  {
    match: /\/src\/tests\/server\//,
    msg: 'This edits a backend test. Load the test-harness skill (Skill tool)'
      + ' for the fixtures and the per-worker template database; new backend'
      + ' behavior also owes a cross-tenant isolation test (must 404, not leak).',
  },
  {
    match: /\/server\/db\/migrations\//,
    msg: 'This edits a migration. Numeric prefixes stay monotonic and'
      + ' zero-padded, and deploys follow expand → migrate → contract (never'
      + ' drop a column in the same deployment as the code change). Editing an'
      + ' ALREADY-APPLIED migration in place needs GIGBUDDY_TEST_FRESH_TEMPLATE=1'
      + ' for backend tests to see it.',
  },
]

let raw = ''
process.stdin.on('data', (d) => { raw += d })
process.stdin.on('end', () => {
  let path = ''
  try {
    path = (JSON.parse(raw).tool_input || {}).file_path || ''
  } catch {
    process.exit(0)
  }
  const p = path.replace(/\\/g, '/')

  const messages = RULES.filter((rule) => rule.match.test(p)).map((rule) => rule.msg)
  if (messages.length > 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: messages.join('\n\n'),
      },
    }))
  }
  process.exit(0)
})
