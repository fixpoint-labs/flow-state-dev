---
"@flow-state-dev/client": minor
"@flow-state-dev/react": patch
"@flow-state-dev/workforce": minor
"@flow-state-dev/shift-manager": patch
---

Keep a screen current on change notices with one call, `client.live`, the live read (FIX-2551). Every watch in the framework now runs on it, so every live screen behaves the same way.

- **client:** `client.live(topics, { read, onValue, hear, paths, onStale, onError, pollIntervalMs, readNow })` reads now and again on each notice under `topics` that `hear` (which notices) and `paths` (which resource paths, as roots or roots per scope) let through. One read runs at a time with at most one waiting, however many notices land; a waiting read is handed the notice that woke it, or `null` for several different ones. A value is reported only when it changed, compared by value. A read that fails tries again on its own, 1 s doubling to 30 s, and `onStale(true)` says the screen is stale until a read lands (`onStale(false)`). Where push can miss a change it reads on a timer, every 3 s by default (`pollIntervalMs: null` for none). With `topicsFromResult: true`, `read` returns `{ value, topics }` and the live read re-subscribes when that set of topics changes, then reads once more. Returns `{ refresh(), close() }`. New types: `LiveRead`, `LiveReadOptions`, `LiveReadWithTopicsOptions`, `LiveResult`, `LivePaths`.
- **react:** a `useSubscription` read that throws, and a live panel's read that fails (`Roster`, `BoardColumns`, `BoardList`, `useSessionList`), now try again on their own, 1 s doubling to 30 s. Before, they waited for the next change, which while push is up may never come. `useSubscription`'s signature is unchanged.
- **workforce:** `watchRoster` runs on `client.live`: a failed read is tried again on its own, with no change needed. `WorkforceClientSource` now picks `live` from the client instead of `subscribe`; a full client from `createClient` already has it. If you pass a slice of your own, add `live`.
- **shift-manager:** the snapshot's lapsed read tries again on the client's backoff (1 s, doubling to 30 s), where it used its own (2 s, doubling).

Docs: apps/docs/guides/realtime.md (keeping a screen current is `client.live`; how `hear` and `paths` decide which notices read, the retry and `onStale`, the 3 s timer, and topics from the last result), packages/client/README.md (a `client.live` row and example beside `subscribe`), apps/docs/docs/api/client.md (same as the client README), apps/docs/docs/client/react.md and apps/docs/docs/api/react.md (where they describe `useSubscription`: it runs on the live read, and a read that throws tries again on its own), packages/workforce/README.md (`watchRoster` retries a failed read; `WorkforceClientSource` needs `live`). No new page.
