---
name: material-ui-theming
description: Guides Material UI theming and design tokens (createTheme, ThemeProvider, palette, colorSchemes, cssVariables, theme.vars, dark mode, TypeScript augmentation). Use when building or extending a theme, toggling light/dark, or aligning tokens across an app.
user-invocable: false
---

# Material UI theming and design tokens

This skill covers theme creation, design tokens, light/dark toggling, and CSS theme variables for MUI v9. See [AGENTS.md](./AGENTS.md) for the full upstream guide and [reference.md](./reference.md) for TypeScript snippets.

## When to apply

- `createTheme`, `ThemeProvider`, `useTheme`, `CssBaseline`
- `colorSchemes`, `useColorScheme`, storage / SSR behavior
- `cssVariables: true`, `theme.vars`, `applyStyles('dark', …)`
- Custom theme keys and TypeScript module augmentation
- Dark/light mode branching in components

## Project-specific conventions (gigbuddy)

### Theme is built via `createAppTheme`

`src/theme.ts` exports `createAppTheme(mode, primaryColor?)`. **Never call `createTheme` directly in a component or context** — always go through `createAppTheme` so scrollbar overrides, `borderRadius: 12`, and component defaults stay consistent.

### Two providers, one mode source

| Provider | File | Role |
| :--- | :--- | :--- |
| `ThemeContextProvider` | `src/contexts/ThemeContext.tsx` | Root: holds `mode` state, reads/writes `localStorage`, wraps app in `ThemeProvider` and `ThemeModeContext.Provider` |
| `TenantThemeProvider` | `src/contexts/TenantThemeProvider.tsx` | Inner: re-creates the theme with the tenant's `accentColor` from `useProfile()` and nests a second `ThemeProvider` |

`TenantThemeProvider` must be placed **inside** `ThemeContextProvider` (it reads `useThemeMode`).

### Reading the current mode

**Always use `useThemeMode()` from `src/contexts/themeModeContext.ts`**, not `useTheme().palette.mode`:

```ts
import { useThemeMode } from '../contexts/themeModeContext.ts'

const { mode, toggleTheme } = useThemeMode()
// mode: 'light' | 'dark'
```

Use `mode` to switch conditional styles (e.g. logo variants) and call `toggleTheme()` for the dark-mode toggle button.

### Design tokens in use

| Token | Value | Notes |
|:---|:---|:---|
| `shape.borderRadius` | `12` | Material 3 card radius; used everywhere |
| `typography.fontFamily` | `'Roboto, sans-serif'` | |
| `palette.primary.main` | `'#6750A4'` (light) / `'#D0BCFF'` (dark) | Overridable per-tenant via `accentColor` |
| `palette.secondary.main` | `'#625B71'` (light) / `'#CCC2DC'` (dark) | |
| `palette.background.default` | `'#FFFBFE'` (light) / `'#1C1B1F'` (dark) | |
| `palette.background.paper` | `'#FFFFFF'` (light) / `'#2B2930'` (dark) | |

### Do not branch on `useTheme().palette.mode`

The MUI `useColorScheme` API is **not in use** here (no `cssVariables: true`, no `colorSchemes`). Mode lives in `ThemeModeContext`. Branching on `theme.palette.mode` technically works but bypasses the single source of truth and will surprise future readers. Use `useThemeMode().mode`.

### Adding component overrides

Put them in `createAppTheme` under `components:`, following the existing `MuiButton` / `MuiChip` pattern. Never add one-off `sx` workarounds to fix a global styling issue — fix it in the theme.

### Tenant accent color

`TenantThemeProvider` passes `accentColor` as `primaryColor` to `createAppTheme`. The value comes from `useProfile().accentColor` (a hex string or `null`). When the user hasn't set one, `createAppTheme` falls back to the default primary for the current mode.

## Full upstream guide

Read [AGENTS.md](./AGENTS.md) for complete MUI v9 theming rules (palette facts, color schemes, CSS variables, composing themes, nesting providers, TypeScript augmentation).

TypeScript snippets: [reference.md](./reference.md).
