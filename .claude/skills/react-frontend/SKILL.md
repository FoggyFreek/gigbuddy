---
name: react-frontend
description: Rules and best practices for React and TypeScript frontend development. Use when writing or reviewing React components, hooks, or JSX — covering purity, rendering rules, hook constraints, and immutability. Based on the official React Rules reference.
user-invocable: false
---

# React Frontend Rules

This skill provides the authoritative rules for writing correct, idiomatic React code. See the detail files for full explanations and code examples:

- [purity-and-rendering.md](purity-and-rendering.md) — purity, idempotency, side effects, and immutability rules
- [rules-of-hooks.md](rules-of-hooks.md) — where and how Hooks can be called
- [react-calls-components.md](react-calls-components.md) — why React (not you) must call components and Hooks

## Quick Reference

### Components and Hooks must be pure
| Rule | Allowed | Not allowed |
|---|---|---|
| Idempotent render | Same output for same props/state/context | `new Date()`, `Math.random()` in render body |
| Side effects | Event handlers, `useEffect` | Network calls, DOM mutations, subscriptions in render |
| Props | Read-only | `props.x = newValue` |
| State | `setState(newValue)` | `state.x = newValue` |
| Hook arguments | Spread a copy: `{ ...arg }` | Direct mutation of Hook arguments |
| Hook return values | Treat as read-only | Mutating memoized return values |
| Post-JSX mutation | Derive new values before JSX | Mutating an object after passing it to JSX |

### Rules of Hooks
- Call Hooks **only at the top level** of a function component or custom Hook
- Call Hooks **only from React functions** (function components or custom Hooks)
- Never call Hooks inside: conditions, loops, nested functions, `try/catch`, event handlers, or class components

### React calls components and Hooks
- Use components in **JSX only** — never call `MyComponent()` directly
- Never pass a Hook as a prop or variable — always call it inline
- Never write higher-order Hooks that wrap other Hooks dynamically

### MUI styling conventions (**MUI v9**, Material 3)
- **Never use the `color` prop directly on MUI `Typography` or `Box`.** Always put color inside `sx`: `sx={{ color: 'text.secondary' }}`, not `color="text.secondary"`.
- All other MUI system props (`justifyContent`, `alignItems`, `gap`, etc.) also belong in `sx`, never as bare props. `TextField`'s `inputProps` is replaced by `slotProps.htmlInput`.
- Theme-mode branching uses `useThemeMode()` (`src/contexts/themeModeContext.ts`), **not** `useTheme().palette.mode`.
- Money in tables uses `<MoneyCells>` + `<MoneyHeaderCells>` — each emits **two** `<TableCell>`s, so account for that in `colSpan`; compact cards use `formatEur`.
- MUI icons are typed `SvgIconComponent`.

### Types
- Reuse `src/types/entities.ts` / `src/types/api.ts` rather than redeclaring shapes.
- Fields that carry `null` in payloads are `T | null`, **not** `T?` — switching a call site to `undefined` changes the JSON.
- Response-shape concerns stay in `api.ts`. The cross-tenant band label is `CrossTenantRef` / `MaybeCrossTenant<T>`, so entities carry no tenant-label fields.
- Components declare a local `Props` interface — **no `prop-types`** anywhere in this repo.
- Imports use explicit extensions, and `vi.mock` paths must match the `.ts`/`.tsx` source.

### Cross-feature hooks
`usePermissions`, `useEntitlements`, `useTenantKind`, `useAccountingProfile`, `useTenantQuerySync`, plus:

- `useDebouncedSave` — 600 ms; call `flush()` when a modal closes. Tests use `vi.useFakeTimers()` + `vi.runAllTimersAsync()`.
- `useCompactLayout()` — compact-vs-desktop **structure** (table→card, stacked controls). It honors `CompactLayoutContext`, which `SplitView` forces. No new direct `useMediaQuery(breakpoints.down('sm'))` checks; name the boolean `isCompact`.

### Tutorials
Frontend-driven, no backend or schema change needed: registry `src/tutorials/registry.tsx` (array order = priority), `useActiveTutorial.ts`, `TutorialHost.tsx`. Dismissals are per-user, cross-tenant, and ride on `/auth/me`. **Never rename a shipped tutorial key** — it is persisted.

## Key file locations in this project
- `src/<domain>/<feature>/` — feature pages, API wrappers, feature components, hooks, helpers, i18n, and tests
- `src/app/` — app composition and route tree
- `src/components/` — reusable shared UI only
- `src/hooks/` — genuinely cross-feature hooks (`useDebouncedSave`, `useCompactLayout`, `useTenantQuerySync`)
- `src/contexts/` — global React context providers (`AuthContext`, `ProfileContext`, `ThemeContext`, `ToastContext`, …)
- `src/utils/` — genuinely cross-feature pure utility functions (no hooks, no JSX)
- `src/types/` — shared entity types (`entities.ts`) and api shapes (`api.ts`)
- `src/api/_client.ts` — the sole HTTP client; each feature keeps its thin `request<T>()` wrapper in its own slice
