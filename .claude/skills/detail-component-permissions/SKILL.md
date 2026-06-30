---
name: detail-component-permissions
description: How to gate editing affordances in detail/editor components on the active tenant's capabilities. Use when writing or reviewing any component that shows a single resource with editable fields, create/delete/upload controls, or vote/assign actions — covers the canWrite prop contract, disable-vs-hide rules, preserving self-actions, prop threading, and required reader-mode tests. Canonical example: the GigDetailPage stack.
user-invocable: false
---

# Detail-component permissions

A detail/editor component must never assume the viewer can write. Readers
(and any role without the relevant capability) have to see a coherent
read-only view — **not** controls that look editable and then fail with a 403.
The server is the real authorization boundary; this gating is the UX side of
it and must mirror the server's permission for **each** operation.

The anti-pattern this skill exists to prevent: a parent hides only the
top-level Delete button while the detail component still renders every field
and sub-control as editable.

## The contract

1. **Every detail/editor component takes a `canWrite` prop**, defaulting to
   `true`. The default keeps writer-mode call sites and existing tests working
   unchanged; only readers pass `false`.
   ```tsx
   interface GigDetailContentProps {
     gigId: Id
     canWrite?: boolean   // false ⇒ read-only view
   }
   function GigDetailContent({ gigId, canWrite = true }: GigDetailContentProps) { … }
   ```

2. **The page resolves the capability and passes it down.** Capabilities come
   from `usePermissions()` (backed by the shared role→permission matrix in
   `shared/permissions.js`, surfaced via `src/auth/permissions.ts`), never from
   an ad-hoc role string check.
   ```tsx
   const { canWritePlanning } = usePermissions()
   <GigDetailContent gigId={gigId} canWrite={canWritePlanning} … />
   ```

3. **Thread the prop into every sub-component** that owns a write affordance —
   don't stop at the outermost component. The gig stack passes `canWrite` into
   `GigParticipantsSection`, `GigContactsSection`, `GigAttachments`, and
   `GigTasks`.

## Disable vs. hide vs. keep

Apply consistently:

- **Fields that display the resource's data → render but `disabled={!canWrite}`.**
  A reader still needs to read the values; a disabled input shows them greyed
  out. Covers `TextField`, `Select`, `Switch`, `TimePicker`, pickers
  (`VenuePicker` takes `disabled`), etc.
- **Pure action affordances → hide with `{canWrite && (…)}`.** Create/Add rows,
  Upload/Replace/Remove buttons, delete icons, "add" pickers. There's nothing
  to read, so don't show a disabled stub.
- **Read affordances → always keep.** "Open link", copy-to-clipboard, download
  links stay live for everyone.

## Preserve genuine self-actions

Some roles keep a narrow self-action even without write. Gate that affordance
on a **separate, specific prop**, not on `canWrite`, and keep *only* that one
control live. Match the server's self-action permission exactly.

Example — a reader may tick *their own* assigned gig task done
(`task.complete.self` on the server), but nothing else. `GigTasks` takes a
`currentBandMemberId` and keeps just that checkbox enabled:
```tsx
const canToggleDone = canWrite || (task.assigned_to != null && task.assigned_to === currentBandMemberId)
<Checkbox disabled={!canToggleDone} onChange={() => handleToggle(task)} />
// create row, delete button, due-date and assignee edits remain canWrite-gated
```

**Mirror the server per operation — don't generalize across surfaces.** Gig
participant voting is `planning.write` (so it's disabled for readers), whereas
rehearsal voting is a self-action (`rehearsal.respond.self`). Check the route's
`requirePermission(...)` before deciding whether an action is a self-action.

## Defense in depth

Disabling/hiding is UX, not security. As a cheap backstop, early-return from
mutating handlers when the caller can't write:
```tsx
function handleChange(field: string, value: unknown) {
  if (!canWrite) return
  …
}
```
The server gate (`requirePermission`) remains the actual boundary.

## Tests — reader mode is mandatory

Writer-mode tests are not enough. For every gated component add **negative
reader-mode tests** (`canWrite={false}`) asserting:

- editable fields are `disabled`,
- action controls (add/create/delete/upload/pickers) are **absent**,
- read affordances (open/copy) are still present,
- any preserved self-action still works for the entitled user and is disabled
  for everyone else.

`userEvent` refuses to click an element with `pointer-events: none` (a disabled
control), which itself proves the control is inert; to assert "no save fired"
drive the click with `userEvent.setup({ pointerEventsCheck: 0 })` and assert the
API mock was not called. See `src/tests/GigTasks.test.jsx` and
`src/tests/GigDetailContent.test.jsx` for the reader-mode patterns.

## Canonical example

Copy the gig detail stack:

- `src/pages/GigDetailPage.tsx` — reads `usePermissions().canWritePlanning`,
  passes `canWrite` down, and also hides its own Delete button.
- `src/components/GigDetailContent.tsx` — disables all form fields, hides the
  banner controls, threads `canWrite` (and `currentBandMemberId`) into children.
- `src/components/GigParticipantsSection.tsx` — disabled `VoteToggle`, hidden
  add row / remove buttons.
- `src/components/GigContactsSection.tsx` — hidden primary/remove/add, kept
  open + copy.
- `src/components/GigAttachments.tsx` — hidden add + delete.
- `src/components/GigTasks.tsx` — self-action checkbox preserved, rest gated.
