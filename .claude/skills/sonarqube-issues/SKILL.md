---
name: sonarqube-issues
description: How to query and act on SonarQube issues via the MCP server. Use when fetching open issues, filtering by severity, changing issue status, or analyzing code quality for this project.
user-invocable: true
---

# SonarQube MCP Server — Issues Skill

This skill covers how to use the SonarQube MCP server tools to inspect and manage code quality issues for this project.

## Project key

This project's key is **`FoggyFreek_gigbuddy`**.

Resolution order if ever in doubt:
1. `.sonarlint/connectedMode.json` → `projectKey` field
2. `sonar-project.properties` → `sonar.projectKey`
3. CI/CD pipelines (`.github/workflows/*.yml`)
4. `mcp__sonarqube__search_my_sonarqube_projects` to list all projects

## Tool: search_sonar_issues_in_projects

Fetch, filter, and paginate through issues across one or more projects.

```
mcp__sonarqube__search_sonar_issues_in_projects
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projects` | string[] | no | Limit to specific project keys, e.g. `["FoggyFreek_gigbuddy"]` |
| `severities` | enum[] | no | `INFO`, `LOW`, `MEDIUM`, `HIGH`, `BLOCKER` |
| `issueStatuses` | enum[] | no | `OPEN`, `CONFIRMED`, `FALSE_POSITIVE`, `ACCEPTED`, `FIXED`, `IN_SANDBOX` |
| `impactSoftwareQualities` | enum[] | no | `MAINTAINABILITY`, `RELIABILITY`, `SECURITY` |
| `issueKey` | string[] | no | Retrieve specific issues by key |
| `pullRequestId` | string | no | Scope to a pull request |
| `p` | number | no | Page number (default: 1) |
| `ps` | number | no | Page size 1–500 (default: 100) |

### Common queries

**Open BLOCKER and HIGH issues:**
```
projects: ["FoggyFreek_gigbuddy"]
severities: ["BLOCKER", "HIGH"]
issueStatuses: ["OPEN"]
```

**Security issues only:**
```
projects: ["FoggyFreek_gigbuddy"]
impactSoftwareQualities: ["SECURITY"]
issueStatuses: ["OPEN"]
```

**All open issues (paginated):**
```
projects: ["FoggyFreek_gigbuddy"]
issueStatuses: ["OPEN"]
ps: 500
```

**Specific issue by key:**
```
issueKey: ["AZ5rewoKsLM8l5Ozflv4"]
```

---

## Tool: change_sonar_issue_status

Update the resolution state of a single issue.

```
mcp__sonarqube__change_sonar_issue_status
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | Issue key (from search results) |
| `status` | enum | yes | `accept`, `falsepositive`, or `reopen` |

### Examples

Mark a test-only false positive:
```
key: "AZ5rewoKsLM8l5Ozflv4"
status: "falsepositive"
```

Accept a known issue as intentional:
```
key: "AZ4wnzPayEig4NsZfHar"
status: "accept"
```

---

## Tool: analyze_code_snippet

Run SonarQube analyzers on a file or code fragment without a full CI scan.

```
mcp__sonarqube__analyze_code_snippet
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectKey` | string | yes | `FoggyFreek_gigbuddy` |
| `filePath` | string | no | Project-relative path when workspace is mounted |
| `fileContent` | string | no | Full file source as a string |
| `codeSnippet` | string | no | Specific region to filter results |
| `language` | string | no | Language hint (e.g. `javascript`, `typescript`) |
| `scope` | enum | no | `MAIN` (default) or `TEST` |

---

## Tool: get_project_quality_gate_status

Check whether the project passes its configured quality gate.

```
mcp__sonarqube__get_project_quality_gate_status
  projectKey: "FoggyFreek_gigbuddy"
```

---

## Tool: search_my_sonarqube_projects

List all available projects (use to discover project keys).

```
mcp__sonarqube__search_my_sonarqube_projects
  q: "gigbuddy"   # optional name filter
```

---

## Severity guide for this project

| Severity | SonarQube label | Act on? |
|---|---|---|
| BLOCKER | Test cases missing assertions, unsafe SQL without WHERE | Fix immediately |
| HIGH/CRITICAL | Cognitive complexity > 15, deeply nested functions | Fix before merge |
| MEDIUM/MAJOR | Style: prefer `.dataset`, duplicate literals in SQL | Fix when touching the file |
| LOW/INFO | Minor style | Accept or ignore |

## Rule disposition guide (this project)

Defaults learned from triaging the backlog. These are starting points, not blanket
rules — still read the actual code.

**Reliably false-positive here → mark `falsepositive`:**
- "add at least one assertion": our backend tests assert via supertest
  `.expect(<status>)` and frontend tests via testing-library `waitFor(() => getByText())`.
  Sonar recognizes neither. Effectively always FP in `src/tests/**`.
- "=== always false": fires on legit type-union comparisons (e.g. a MUI
  Select value that is genuinely `'' | number`, or a state union guarded one line up).
  Confirm the union really includes the compared value, then dismiss.

**Intentional here → mark `accept`:**
- "propTypes is deprecated": CLAUDE.md *mandates* propTypes on every
  component. Removing them violates project convention.

**Verify before auto-applying — the suggested fix can be a bug:**
- "use Math.min": only valid for numbers. Our date helpers compare
  `'YYYY-MM-DD'` *strings* with `<`/`>`; `Math.min` would coerce them to `NaN`. FP.
- optional-chaining & similar: confirm the `a && a.b` guard and the
  rewritten `a?.b` have identical truthiness in the surrounding `||`/ternary before
  swapping.
- "use String.raw": can't represent a lone trailing backslash (it escapes
  the closing backtick). Not applicable to single-`\` replacement targets → accept.

**Don't churn readable code just to satisfy it:**
- cognitive complexity, often only 1–2 over: extracting *backend* validation
  helpers is usually a clean win. But a **flat, readable `switch`** (e.g.
  `ledgerEntryTypes.describe`) is preferred as-is over a lookup-map rewrite — that
  conversion was reverted. For large, well-tested UI components, prefer a small safe
  extraction or `accept` over a risky restructure.

**Process notes:**
- Sonar issue **line numbers drift** as you edit a file. After your first edit in a
  file, locate later issues by *content* (Grep), not the stored line number.
- `search_sonar_issues_in_projects` output can exceed the token cap; it's written to a
  file. Parse with `node -e` (no `jq` on this box) rather than reading raw chunks.
- For array-index keys on add/remove/duplicate line editors: the rows carry
  no stable id and hold local state, so add a synthetic `_key` at construction
  (`emptyLine`/`*ToForm`, new key on duplicate) and confirm the payload builder
  whitelists fields so `_key` never reaches the API.
