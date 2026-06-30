---
name: i18n
description: i18next / react-i18next localization for this app — the v26 TypeScript selector API (`t($ => $.key)`), namespaces, plurals, interpolation, and Intl formatting, plus the localization best practices that keep strings translatable. Use when adding, wiring, or reviewing translations. Pinned to i18next 26.3.2 / react-i18next v17. Full directive tables and examples live in i18n_reference.md.
user-invocable: false
---

# i18n — i18next localization for this app

Translations use **i18next 26.3.2** with **react-i18next v17** (the TypeScript selector API). This file is the entry point and the rules that bite; [i18n_reference.md](./i18n_reference.md) has the full tables and worked examples — read it before any non-trivial change. Treat i18next.com as authoritative over memory; if a directive or option is unclear, fetch the specific docs page rather than guessing.

> Deps: `i18next`/`react-i18next`/`i18next-browser-languagedetector`. `src/i18n/` holds the config (`index.ts`), `en/`+`nl/` resources, and `i18next.d.ts` (selector-type augmentation, `enableSelector: true`). The side-effect `import './i18n/index.ts'` lives in `main.tsx` **and** in `src/tests/setup.js` (which also pins `changeLanguage('en')` so component suites resolve real strings instead of raw keys). Detection persists to localStorage key `gigbuddy_lang`.
>
> **28 namespaces exist** (derived from the AppShell nav groups/items + the domain views). Cross-cutting: `common`, `navigation` (all shell chrome — nav labels, tooltips, aria, search placeholders), `glossary` (plural domain nouns), `validation`. The per-view namespaces are: `dashboard, financialDashboard, profile, availability, gigs, rehearsals, bandEvents, tasks, songs, setlists, contacts, suppliers, venues, emailTemplates, invoices, purchases, merch, reimbursements, journal, ledger, vatReturns, reports, settings, auth`. **Don't create a new namespace per view — the home already exists; extract that view's strings into it.** Verify against the live tree (Grep for `useTranslation`) before trusting specifics. Consolidate when possible and when context is shared.

## The selector API

This stack uses the **TypeScript selector form**. Pass a selector function, not a string:

```ts
const { t } = useTranslation('common');
t($ => $.save);                 // ✅ typed, refactor-safe, autocompletes
t('save');                      // ⚠️ legacy string form — avoid in new code
```

The selector gives full type-checking and autocomplete from the resource JSON, so a renamed/missing key is a **compile error** (`npm run type-check`), not a silent runtime fallback to the raw key. This matters here because the frontend is **TypeScript strict** and `type-check` is a hard gate. Keep new `t()` calls in selector form.

- **Plurals / context**: still selector form — `t($ => $.keyWithCount, { count })`. i18next picks `_one`/`_other` from `count`; you reference the base key.
- **Interpolation values** go in the options object: `t($ => $.greeting, { name })` for `"greeting": "Hi {{name}}"`.
- **keyPrefix** scopes the selector root: `useTranslation('translation', { keyPrefix: 'very.deeply.nested' })` → `t($ => $.key)`.

## Namespaces

Group strings by concern/feature, not one giant file. Convention from the reference: `common.json` (reused labels — Save/Cancel), `validation.json` (form errors), `glossary.json` (consistent domain words), then one namespace per view/feature.

```
src/i18n/
├── en/  ├── common.json  └── gigs.json
└── nl/  ├── common.json  └── gigs.json
```

```ts
const { t } = useTranslation(['common', 'gigs']);   // first ns is the default for bare selectors
t($ => $.save);              // → common (primary)
t($ => $.gigs.title);        // → gigs (v17/v26.0.10+: a selector path whose head matches a *secondary*
                             //   ns is routed there). Note: $.common.x would be a literal sub-key, not a switch.
t($ => $.title, { ns: 'gigs' });   // explicit ns also works
```

### Registering a namespace + the Dutch parity guard

`src/i18n/index.ts` imports every `en/*` and `nl/*` file into two maps. **`en` is canonical** — its shape drives the selector types via `i18next.d.ts` (`resources: typeof resources['en']`), so a new namespace only becomes typed once it's in the `en` map. To stop `nl` drifting silently (the augmentation never looks at it), the `nl` map is checked at compile time:

```ts
type DeepKeyShape<T> = { [K in keyof T]: T[K] extends string ? string : DeepKeyShape<T[K]> }
const nl = { common: nlCommon, /* … */ } satisfies DeepKeyShape<typeof en>
```

A **missing** nl key fails the mapped-type requirement; a **stray** nl key trips `satisfies`' excess-property check. Both surface in `npm run type-check`. So: add the en file (and import), add the matching nl file (and import) with the **same key shape**, done — the guard enforces parity.

### Preserve exact English wording when wiring existing strings

When you replace a hardcoded English string with a `t()` call, the `en` JSON value **must reproduce the old copy verbatim** (including casing and punctuation — `"collapse navigation"`, `"{{name}} group"`, the search placeholder text). Several tests assert on the literal copy (e.g. `AppShellNavGroups`, `AppShellTenantSwitcher`), and with the test setup pinned to `en` they keep passing only if the wording is unchanged.

## Translating enum / status values

Status/enum literals map to a `status` object in the namespace. **The selector API indexes dynamically and stays type-checked** — verified: indexing with a value outside the key set is a `type-check` error (`TS7053`), not a silent fallback.

> ⚠️ **Most entity `status` fields are typed plain `string`, not a literal union** — only `Journal.status` (`'draft' | 'approved'`) and `MerchSale.status` (`'recorded' | 'voided'`) are narrow in `src/types/entities.ts`. `Gig`, `Rehearsal`, `Slot`, `Invoice`, `Purchase`, `VatReturn` all carry `status?: string`. The compile guarantee below only holds for a **literal union**: indexing `$.status[value]` with a plain `string` is itself a type error, so you must **first** tighten the entity field to a union (or narrow the value locally) before the indexed selector will type-check. That's why the scaffold seeded a `status` object only for `journal` and `merch` — add one for another view as part of tightening its union, not before.

**Preferred — no map.** Name the JSON leaf keys to match the literal values, then index the selector directly. The status union *is* the source of truth; there's nothing to keep in sync:

```jsonc
// src/i18n/en/journals.json
{ "status": { "draft": "Draft", "approved": "Approved" } }
```
```ts
const { t } = useTranslation('journals');
// status is 'draft' | 'approved'; every member must exist under $.status or it won't compile
t($ => $.status[status]);
```

**When the literals can't be the keys** (DB values are capitalized/abbreviated, or you want display order decoupled), keep a `const` map to the **leaf-key segment** and still feed it through the selector — never to a bare `t('a.b.c')` string:

```ts
const journalStatusKey = {
  draft: 'draft',
  approved: 'approved',
} as const satisfies Record<JournalStatus, string>;   // `as const` keeps values literal so the selector index type-checks

t($ => $.status[journalStatusKey[status]]);
```

- **Don't** map enum → dotted string and pass it to `t(string)` (the pattern you'll see in other apps). That's the legacy string form — it compiles but is **not** checked against the resource JSON, so a typo or renamed key fails silently at runtime. Loses the entire reason this stack uses the selector API.
- **No `switch`** to pick a label per status — the map (or direct index) replaces it.
- Assert where a specific component or control is used before deciding a namespace target. If a status is used in multiple views, put it in a shared namespace (e.g. `common` or `glossary`) rather than duplicating it in each view's namespace.
- **Guard optionals first.** Most of these fields are declared `status?: '…'` in `src/types/entities.ts`, so the value can be `undefined`; narrow it (`status && t($ => $.status[status])`) before indexing.

## Translatability

These are the highest-value parts of the reference; violating them produces strings that *cannot* be translated correctly:

- **Avoid interpolation for values you already know at translation time.** Concatenating sentence fragments breaks in languages where surrounding words inflect (the German `dem`/`der` article example in the reference). Write **two self-contained strings**, not one with a `{{paymentType}}` hole. Interpolation is only for genuinely runtime-only values: timestamps, user input, counts.
- **Pluralize with `count`, never with `if`.** Use `key_one`/`key_other` keys; let i18next's CLDR plural rules choose. Don't branch in JS to pick singular vs plural strings — other languages have more than two plural forms.
- **Format numbers/dates/currency/lists via the built-in Intl formatters**, not manual string building: `{{val, number}}`, `{{val, currency(EUR)}}`, `{{val, datetime}}`, `{{val, relativetime}}`, `{{val, list}}`. They localize separators, currency placement, and conjunctions per locale. (This app already has `formatEur`/`MoneyCells` for table money — keep using those for tables; reach for the i18next currency formatter for money *inside translated sentences*.)
- **Interpolation auto-escapes** (XSS mitigation). Only use the unescape form (`{{- var}}` / `escapeValue:false`) for values you've already sanitized — same DOMPurify discipline as the ChordPro path.

## Where to find detail

[i18n_reference.md](./i18n_reference.md) covers, with runnable examples:
- **Translation resolution & fallback order** (similar keys → languages → namespaces → fallback keys → key itself), language codes, `i18next.languages`/`resolvedLanguage`.
- **Plurals** — full key shapes and `count` behavior.
- **Interpolation** — nested data models (`{{author.name}}`), escaping.
- **Formatting** — number / currency / datetime / relativetime / list, `formatParams`, per-value `lng`, custom `formatter.add`/`addCached`, chained formatters.

Anything not in either file: fetch the matching i18next.com docs page.
