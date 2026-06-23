---
"@flow-state-dev/react": minor
---

Polish the default approval card and collapse it to a receipt once resolved.

Previously a resolved suspension left the `ApprovalRenderer` card on screen with
its buttons merely disabled. It now collapses to a compact one-line receipt (e.g.
`✓ Approved` / `✕ Rejected`) once the suspension resolves — either from the action
taken on the card or from a matching `suspension_resume` item arriving in the
stream.

The pending card is also redesigned: green Approve / red Reject buttons with hover
and focus states, and a scoped stylesheet (injected once) with a
`prefers-color-scheme` block so the card reads on both light and dark surfaces
instead of relying on theme-blind inline styles.

- `ApprovalRenderer` gains an optional `resolution?: SuspensionStatus` prop that
  drives the receipt's outcome label/tone. `ItemRenderer` and `ItemsRenderer`
  thread it down from the matching `suspension_resume` item, so a reloaded log
  shows the real outcome (not just a generic "resolved").
- New exported helper `resolveApprovalOutcome(status)` → `{ icon, label, toneClass }`
  (and the `ApprovalOutcome` type) for consumers building their own receipt UI.
