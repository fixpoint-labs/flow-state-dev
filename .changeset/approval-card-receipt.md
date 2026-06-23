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
and focus states, via a scoped stylesheet (injected once) instead of theme-blind
inline styles. The card is theme-agnostic — a neutral translucent surface plus
`color: inherit` — so it reads on both light and dark backgrounds without any
theme detection.

- `ApprovalRenderer` gains an optional `resolution?: SuspensionStatus` prop that
  drives the receipt's outcome label/tone. `ItemRenderer` and `ItemsRenderer`
  thread it down from the matching `suspension_resume` item, so a reloaded log
  shows the real outcome (not just a generic "resolved").
- New exported helper `resolveApprovalOutcome(status)` → `{ icon, label, toneClass }`
  (and the `ApprovalOutcome` type) for consumers building their own receipt UI.
