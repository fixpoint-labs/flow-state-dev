---
"@flow-state-dev/workforce": minor
---

The roster flow answers a new user view, `inbox` (`inboxViewRef` in `@flow-state-dev/workforce/browser`): what waits on the user across all their sessions, and every row on their conversation boards, as `{ items, tasks }`, built on the server and typed by the view. Each ask names its worker, or none for a run with no conversation; each row names its board owner. It wakes when an ask is raised or answered and when a board row is written, never for a streamed reply or a turn elsewhere (FIX-2774).

Docs: packages/workforce/README.md (the roster flow's views)
