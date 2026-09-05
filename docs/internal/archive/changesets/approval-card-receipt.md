---
"@flow-state-dev/react": minor
"@flow-state-dev/ui": minor
---

Split the approval UI into logic (react) and presentation (ui), and collapse it to
a receipt once resolved.

Previously a resolved suspension left the approval card on screen with its buttons
merely disabled, and the only card was a styled component living in
`@flow-state-dev/react` — a runtime logic package with no styling system. That card
is now a minimal, unstyled default, and the polished card lives where presentation
belongs.

- `@flow-state-dev/react`: new headless `useApproval(item)` hook owns the resume
  transport, in-flight/error state, the duplicate-resume guard, and the resolved
  outcome. `ApprovalRenderer` is now a minimal built-in default (plain buttons, a
  one-line text receipt once resolved) that consumes the hook — so a `suspension`
  item still renders something actionable with zero setup. `resolveApprovalOutcome`
  now returns `{ icon, label }` (no `toneClass`); colour is the renderer's concern.
- `@flow-state-dev/ui`: new `Approval` component — a themeable Tailwind card with
  green Approve / red Reject buttons that collapses to a tinted receipt. It's wired
  into `chatAssistantRenderers` as `suspension: Approval`, so chat UIs get it
  automatically (the same "assigned renderer type" pattern as `plan`). It reads
  resolved state from `useSessionItems`, so wrap your item list in
  `<SessionItemsProvider>` for the receipt to show on reload.
