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

Known open BLOCKER patterns (as of 2026-05-28):
- `src/tests/server/contacts.test.js` lines 67, 74, 80, 105, 112 — test cases with no assertions
- `src/tests/server/venueContacts.test.js` lines 66, 75, 81, 102, 136, 151 — same pattern

Known open CRITICAL patterns:
- `server/routes/venues.js:170` — cognitive complexity 51 (way over limit)
- `server/routes/contacts.js:162` — cognitive complexity 19
- `server/routes/rehearsals.js:202` — cognitive complexity 16
- `src/components/ContactPicker.jsx:46` — functions nested > 4 levels
- `src/components/RehearsalFormModal.jsx:189` — functions nested > 4 levels
- `src/pages/ProfilePage.jsx:49` — functions nested > 4 levels
