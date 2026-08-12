# Skill trigger tests

Checks that a skill fires from a *realistic* prompt — one that describes a symptom in
domain language and never names the skill, the file, or the skill's headline nouns.
If a skill only fires when you already say its name, its `description` is not earning
its keep and the content should move back to CLAUDE.md.

## How to run

One prompt per **fresh session** (`/clear` between — a skill loaded earlier in a session
stays loaded and invalidates the next test). Paste the prompt, then watch only the first
few actions: did the Skill tool get called, and with what?

Stop the run once you can see the answer — none of these need to be carried out.

Grading:

- **pass** — the expected skill is invoked before, or as part of, the first substantive step
- **weak** — invoked only after reading a file that names it, or after you nudge
- **fail** — never invoked, or a different one fires instead

`?` in the expected column means "acceptable but not required".

## Prompts

| # | Prompt | Expect |
|---|---|---|
| 1 | "We booked one of last quarter's invoices at the wrong rate and the books are closed. Customer wants a corrected document. What do I do?" | finance-ledger |
| 2 | "On a solo user's agenda the gigs from all their bands show up fine, but opening one 404s." | tenant-model |
| 3 | "A drummer says the days he blocked off show his reason text to a band he didn't want seeing it." | availability |
| 4 | "Someone on the cheap solo plan just made a second band and nothing stopped them. Bug?" | subscription-billing |
| 5 | "The past-gigs list is stuck at ten rows and the button underneath does nothing." | collection-scoping, react-frontend? |
| 6 | "I widened a column in one of the older .sql files, but the server tests still blow up on the old width." | test-harness |
| 7 | "The merch endpoint has raw SQL sitting in the route handler. Tidy it up." | backend-layering |
| 8 | "Type-check is red on a missing key under the settings namespace, but only for Dutch." | i18n |
| 9 | "A member with no write role still sees editable fields on the gig page, then eats a 403 when they hit save." | detail-component-permissions |
| 10 | "Add a Download PDF button to the invoice list." | react-frontend, finance-ledger? |

## Negative controls

These must trigger **nothing** — a skill firing here means a description is too greedy.

| # | Prompt | Expect |
|---|---|---|
| N1 | "Move the Vite dev server off 5173, something else has the port." | — |
| N2 | "What's the rustfs_init container in compose actually for?" | — |
| N3 | "Rename the `notifyRehearsalCreated` export to `notifyRehearsalScheduled` everywhere." | — |

## Hook coverage (separate mechanism)

`.claude/hooks/skill-reminder.mjs` fires on Edit/Write by **path**, independent of prompt
wording. Test it directly instead of through a conversation — single-line commands, from
the repo root:

```
printf '%s' '{"tool_input":{"file_path":"/x/src/finance/ledger/a.tsx"}}' | node .claude/hooks/skill-reminder.mjs
printf '%s' '{"tool_input":{"file_path":"/x/server/planning/gigs/gigService.js"}}' | node .claude/hooks/skill-reminder.mjs
```

The first must emit **two** reminders (react-frontend + finance-ledger); the second must
emit nothing.
