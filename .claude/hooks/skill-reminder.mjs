#!/usr/bin/env node
// PreToolUse hook: reminds Claude to load the relevant skill before editing
// frontend or i18n files (a CLAUDE.md convention that is easy to skip on tasks
// that "look simple"). Reads the hook payload on stdin, emits additionalContext
// only for matching paths, and stays silent otherwise.

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

  let msg = ''
  if (/\/src\/i18n\//.test(p)) {
    msg = 'This edits an i18n file. Per CLAUDE.md, load the i18n skill (Skill tool) '
      + 'before non-trivial translation work if you have not already this session.'
  } else if (/\/src\/.*\.tsx?$/.test(p)) {
    msg = 'This edits frontend TypeScript/React code. Per CLAUDE.md, load the '
      + 'react-frontend skill (Skill tool) before working on the front end if you '
      + 'have not already this session.'
  }

  if (msg) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
    }))
  }
  process.exit(0)
})
