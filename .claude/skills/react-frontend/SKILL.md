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

### MUI styling conventions
- **Never use the `color` prop directly on MUI `Typography` or `Box`.** Always put color inside `sx`: `sx={{ color: 'text.secondary' }}`, not `color="text.secondary"`.
- All other MUI system props (`justifyContent`, `alignItems`, `gap`, etc.) also belong in `sx`, never as bare props.

## Key file locations in this project
- `src/pages/` — page-level components
- `src/components/` — shared and feature components
- `src/hooks/` — custom hooks (`useDebouncedSave`, `useCompactLayout`, `useGigMapData`, `usePushNotifications`, `useTenantQuerySync`)
- `src/contexts/` — global React context providers (`AuthContext`, `ProfileContext`, `ThemeContext`, `ToastContext`, …)
- `src/utils/` — pure utility functions (no hooks, no JSX)
- `src/types/` — shared entity types (`entities.ts`) and api shapes (`api.ts`)
- `src/api/` — thin `request<T>()` wrappers, one per resource (the only place that knows the `/api/*` path)
